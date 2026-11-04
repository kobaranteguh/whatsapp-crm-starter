'use strict';

/**
 * The only file that talks to WasapFlow Bridge.
 * Plain REST over HTTPS — no SDK. Docs: https://raw.githubusercontent.com/kobaranteguh/api/main/README.md
 *
 * Every call sends x-partner-key. Number-scoped calls also send x-waba-id and
 * x-phone-number-id (a WABA can hold more than one number; with only x-waba-id
 * Bridge refuses the call for multi-number WABAs).
 */

const BASE = (process.env.WASAPFLOW_BASE_URL || 'https://officialapi.wasapflow.com/bridge/v1').replace(/\/+$/, '');

class BridgeError extends Error {
    constructor(status, error) {
        super(error?.message || `Bridge HTTP ${status}`);
        this.status = status;
        this.code = error?.code || 'HTTP_' + status;
        this.metaCode = error?.meta_code;
        this.details = error?.details;
    }
}

async function call(method, path, { number, body, query } = {}) {
    const key = process.env.WASAPFLOW_PARTNER_KEY;
    if (!key) throw new BridgeError(500, { code: 'NO_PARTNER_KEY', message: 'Set WASAPFLOW_PARTNER_KEY in .env (portal → Integration)' });

    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);

    const headers = { 'x-partner-key': key, accept: 'application/json' };
    if (number?.waba_id) headers['x-waba-id'] = number.waba_id;
    if (number?.phone_number_id) headers['x-phone-number-id'] = number.phone_number_id;
    if (body) headers['content-type'] = 'application/json';

    // One retry on 429 / 5xx, honouring Retry-After.
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) return data;
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
            const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 10) * 1000;
            await new Promise(r => setTimeout(r, wait));
            continue;
        }
        throw new BridgeError(res.status, data.error);
    }
}

module.exports = {
    BridgeError,

    /** All numbers connected to this partner account. */
    listNumbers: () => call('GET', '/clients', { query: { limit: 500 } }).then(d => d.clients || []),

    /** Short-lived link that opens Meta Embedded Signup (Coexistence supported). */
    createConnectSession: (displayName, state) =>
        call('POST', '/connect/session', { body: { display_name: displayName, state } }),

    /** `to` = phone (60123456789) or BSUID (MY.2035...). Only reaches people inside the 24h window. */
    sendText: (number, to, text) => call('POST', '/messages/send', { number, body: { to, text } }),

    /** Approved template — works outside the 24h window. */
    sendTemplate: (number, to, name, language, components) =>
        call('POST', '/messages/template', { number, body: { to, template: { name, language, ...(components ? { components } : {}) } } }),

    listTemplates: (number) => call('GET', '/templates', { number }),

    /** Mark an incoming message as read (blue ticks). */
    markRead: (number, messageId) => call('POST', '/messages/read', { number, body: { message_id: messageId } }),
};
