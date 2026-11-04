'use strict';

/**
 * WhatsApp CRM starter on WasapFlow Bridge.
 *
 *   GET  /                      inbox UI (public/)
 *   POST /webhook/wasapflow     signed webhooks from Bridge  ← set this URL in portal → Integration
 *   POST /api/connect           create a Connect WhatsApp link (Meta Embedded Signup)
 *   POST /api/numbers/refresh   pull connected numbers from Bridge
 *   GET  /api/numbers | /api/contacts | /api/contacts/:key/messages
 *   POST /api/send              text (inside 24h) or template
 */

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const bridge = require('./lib/bridge');
const store = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;
const DAY = 24 * 60 * 60;

// ── Webhook: raw body (signature is over the exact bytes), registered before express.json ──
app.post('/webhook/wasapflow', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    const secret = process.env.WASAPFLOW_WEBHOOK_SECRET || '';
    const sig = String(req.headers['x-wasapflow-signature'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const ok = secret && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return res.status(401).send('bad signature');

    res.status(200).send('OK');                      // answer within 10 s, then process
    let evt;
    try { evt = JSON.parse(req.body.toString('utf8')); } catch (e) { return; }
    try { handleEvent(evt); } catch (e) { console.error('[webhook]', evt.event, e); }
});

function handleEvent({ event, waba_id, phone_number_id, data = {} }) {
    if (phone_number_id && !store.getNumber(phone_number_id)) {
        store.upsertNumber({ waba_id, phone_number_id });
        refreshNumbers().catch(() => {});
    }
    const ts = Number(data.timestamp) || Math.floor(Date.now() / 1000);

    switch (event) {
        case 'message.received': {                   // customer → business
            const c = store.contactFor(phone_number_id, { phone: data.from, bsuid: data.bsuid, name: data.contact_name });
            store.addMessage({ message_id: data.message_id, contact_key: c.key, phone_number_id, direction: 'in', type: data.type, text: data.text ?? null, ts, status: 'received', raw: data.raw?.message });
            break;
        }
        case 'message.echo': {                       // sent from the WhatsApp Business App on the phone (Coexistence)
            const c = store.contactFor(phone_number_id, { phone: data.recipient, bsuid: data.recipient_bsuid });
            store.addMessage({ message_id: data.message_id, contact_key: c.key, phone_number_id, direction: 'out', source: 'business_app', type: data.type, text: data.text ?? null, ts, status: 'sent' });
            break;
        }
        case 'message.history': {                    // one-time backfill after Coexistence onboarding — no auto-replies here
            const c = store.contactFor(phone_number_id, { phone: data.contact_wa_id, bsuid: data.contact_bsuid });
            store.addMessage({ message_id: data.message_id, contact_key: c.key, phone_number_id, direction: data.direction === 'outbound' ? 'out' : 'in', history: true, type: data.type, text: data.text ?? null, ts, status: data.status || 'sent' });
            break;
        }
        case 'message.sent':
        case 'message.delivered':
        case 'message.read':
        case 'message.failed':
            store.updateStatus(data.message_id, data.status || event.split('.')[1], data.errors?.[0] ? `${data.errors[0].code} ${data.errors[0].message || data.errors[0].title}` : null);
            break;
        case 'waba.offboarded':
        case 'waba.partner_removed':
        case 'waba.reconnected':
        case 'waba.quality_updated':
        case 'waba.account_updated':
            console.log('[bridge]', event, waba_id, phone_number_id);
            refreshNumbers().catch(() => {});
            break;
        default:
            // template.*, contact.synced, standby.*, waba.* … add handlers as you need them (see AGENTS.md)
            break;
    }
}

async function refreshNumbers() {
    const list = await bridge.listNumbers();
    for (const n of list) store.upsertNumber({ waba_id: n.waba_id, phone_number_id: n.phone_number_id, phone_number: n.phone_number, display_name: n.display_name, status: n.status, quality_rating: n.quality_rating, connection_mode: n.connection_mode });
    return store.listNumbers();
}

// ── Everything below is the private app: Basic auth ──
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
    const pass = process.env.ADMIN_PASSWORD;
    if (!pass) return next();
    const [, b64] = String(req.headers.authorization || '').split(' ');
    const [, given] = Buffer.from(b64 || '', 'base64').toString().split(':');
    const a = Buffer.from(String(given || '')), b = Buffer.from(pass);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="CRM"').status(401).send('Login required');
});
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch(e => {
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: { code: e.code, message: e.message, meta_code: e.metaCode } });
});

app.post('/api/connect', wrap(async (req, res) => {
    const state = crypto.randomUUID();               // your own client id in a real multi-tenant app
    const s = await bridge.createConnectSession(req.body.display_name || 'My business', state);
    res.json({ connect_url: s.connect_url, state });
}));

app.post('/api/numbers/refresh', wrap(async (req, res) => res.json(await refreshNumbers())));
app.get('/api/numbers', (req, res) => res.json(store.listNumbers()));

app.get('/api/contacts', (req, res) => {
    const now = Date.now() / 1000;
    res.json(store.listContacts().map(c => ({ ...c, window_open: now - c.last_inbound_at < DAY })));
});

app.get('/api/contacts/:key/messages', (req, res) => {
    store.markContactRead(req.params.key);
    res.json(store.listMessages(req.params.key));
});

app.post('/api/send', wrap(async (req, res) => {
    const { contact_key, text, template } = req.body;
    const c = store.getContact(contact_key);
    if (!c) return res.status(404).json({ error: { message: 'contact not found' } });
    const number = store.getNumber(c.phone_number_id);
    if (!number?.waba_id) return res.status(400).json({ error: { message: 'number not known yet — click Refresh numbers' } });

    const r = template?.name
        ? await bridge.sendTemplate(number, c.id, template.name, template.language || 'en_US', template.components)
        : await bridge.sendText(number, c.id, String(text || '').slice(0, 4096));
    const m = store.addMessage({
        message_id: r.message_id || r.messages?.[0]?.id, contact_key: c.key, phone_number_id: c.phone_number_id, direction: 'out', source: 'api',
        type: template?.name ? 'template' : 'text', text: template?.name ? `[template ${template.name}]` : text, ts: Math.floor(Date.now() / 1000), status: 'pending',
    });
    res.json(m);
}));

/** Start a conversation with a new customer (templates only, outside the 24h window). */
app.post('/api/contacts', wrap(async (req, res) => {
    const { phone_number_id, phone, name } = req.body;
    if (!store.getNumber(phone_number_id)) return res.status(400).json({ error: { message: 'unknown number' } });
    if (!store.toPhone(phone) && !store.isBsuid(phone)) return res.status(400).json({ error: { message: 'phone in international format, e.g. 60123456789' } });
    res.json(store.contactFor(phone_number_id, { phone, bsuid: store.isBsuid(phone) ? phone : null, name }));
}));

app.listen(PORT, () => {
    console.log(`WhatsApp CRM starter on http://localhost:${PORT}`);
    console.log(`Webhook URL to save in the portal: https://<your-domain>/webhook/wasapflow`);
    if (!process.env.WASAPFLOW_PARTNER_KEY) console.warn('! WASAPFLOW_PARTNER_KEY missing — copy .env.example to .env');
    if (!process.env.WASAPFLOW_WEBHOOK_SECRET) console.warn('! WASAPFLOW_WEBHOOK_SECRET missing — every webhook will be rejected');
    if (process.env.WASAPFLOW_PARTNER_KEY) refreshNumbers().then(n => console.log(`${n.length} connected number(s)`)).catch(e => console.warn('Could not list numbers:', e.message));
});

module.exports = { app, handleEvent };
