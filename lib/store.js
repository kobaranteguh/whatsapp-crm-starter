'use strict';

/**
 * Tiny JSON-file store so the starter runs with zero setup.
 * Replace with your real database (Postgres, MySQL, Mongo, Prisma...) — keep the
 * same function names and the rest of the app does not change. See AGENTS.md.
 *
 * Contacts follow Bridge's identity rule: a customer may have a phone, a BSUID,
 * or both. `id` (canonical, used for sending) = phone or BSUID; `phone` is only
 * ever a real phone number and may be empty. Never turn a BSUID into a phone.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');
const BSUID = /^(?:whatsapp:)?[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

let db = { numbers: {}, contacts: {}, messages: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { /* first run */ }

let timer = null;
function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
        fs.renameSync(FILE + '.tmp', FILE);
    }, 200);
}

const isBsuid = (v) => !!v && BSUID.test(String(v).trim());
const toPhone = (v) => (!v || isBsuid(v) || /[A-Za-z]/.test(v)) ? '' : String(v).replace(/\D/g, '');

/** Upsert a number (one row per phone_number_id). */
function upsertNumber(n) {
    if (!n?.phone_number_id) return;
    db.numbers[n.phone_number_id] = { ...db.numbers[n.phone_number_id], ...n };
    save();
}
const listNumbers = () => Object.values(db.numbers);
const getNumber = (phoneNumberId) => db.numbers[phoneNumberId] || null;

/** Find or create the contact for a customer on one of our numbers. */
function contactFor(phoneNumberId, { phone, bsuid, name }) {
    phone = toPhone(phone);
    bsuid = isBsuid(bsuid) ? bsuid : (isBsuid(phone) ? phone : null);
    const all = Object.values(db.contacts).filter(c => c.phone_number_id === phoneNumberId);
    let c = (bsuid && all.find(x => x.bsuid === bsuid)) || (phone && all.find(x => x.phone === phone));
    if (!c) {
        const key = `${phoneNumberId}:${bsuid || phone}`;
        c = db.contacts[key] = { key, phone_number_id: phoneNumberId, id: phone || bsuid, phone: '', bsuid: null, name: '', unread: 0, last_at: 0, last_inbound_at: 0 };
    }
    if (phone) { c.phone = phone; c.id = phone; }          // phone wins for sending, like Meta
    if (bsuid) c.bsuid = bsuid;
    if (!c.id) c.id = bsuid;
    if (name) c.name = name;
    save();
    return c;
}

function addMessage(m) {
    if (m.message_id && db.messages.some(x => x.message_id === m.message_id)) return null;   // webhooks can repeat
    db.messages.push(m);
    const c = db.contacts[m.contact_key];
    if (c) {
        if (m.ts >= c.last_at) { c.last_at = m.ts; c.last_text = m.text || `[${m.type}]`; }
        if (m.direction === 'in' && !m.history) { c.unread++; c.last_inbound_at = Math.max(c.last_inbound_at, m.ts); }
    }
    save();
    return m;
}

function updateStatus(messageId, status, error) {
    const m = db.messages.find(x => x.message_id === messageId);
    if (!m) return;
    const rank = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    if ((rank[status] ?? 0) >= (rank[m.status] ?? 0)) m.status = status;
    if (error) m.error = error;
    save();
}

const listContacts = () => Object.values(db.contacts).sort((a, b) => b.last_at - a.last_at);
const getContact = (key) => db.contacts[key] || null;
const listMessages = (key) => db.messages.filter(m => m.contact_key === key).sort((a, b) => a.ts - b.ts);
function markContactRead(key) { const c = db.contacts[key]; if (c) { c.unread = 0; save(); } }

module.exports = { isBsuid, toPhone, upsertNumber, listNumbers, getNumber, contactFor, addMessage, updateStatus, listContacts, getContact, listMessages, markContactRead };
