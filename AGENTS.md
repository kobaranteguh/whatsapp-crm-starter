# AGENTS.md — instructions for AI coding tools

You are working on a WhatsApp CRM built on **WasapFlow Bridge**, the official
WhatsApp Business API (Meta Cloud API) for your own system. Read this file before
changing anything. It applies to Claude Code, Codex, Cursor, Copilot, Windsurf,
Gemini and any other agent.

## Source of truth

- API reference (always current, plain Markdown):
  https://raw.githubusercontent.com/kobaranteguh/api/main/README.md
- Partner guide with ready-made prompts:
  https://raw.githubusercontent.com/kobaranteguh/guide/main/README.md
- Changelog (API and Meta platform changes):
  https://raw.githubusercontent.com/kobaranteguh/changelog/main/README.md
- OpenAPI 3.1: https://officialapi.wasapflow.com/bridge/openapi.json
- MCP server (docs search + live API from your agent):
  `https://officialapi.wasapflow.com/bridge/mcp`, with header `x-partner-key`. The docs tools work without a key.

Fetch the API reference before writing any Bridge call. Do not guess endpoint
names, field names or webhook shapes from memory or from other WhatsApp
providers. Bridge is not Twilio, 360dialog or the raw Meta Graph API.

## Architecture

| File | Role |
|---|---|
| `lib/bridge.js` | The **only** module that calls Bridge. Add new endpoints here as small functions. |
| `lib/store.js` | Storage. JSON file by default. Replace it with a real DB and keep the function names. |
| `server.js` | Webhook receiver, `/api/*` for the UI, Basic auth. |
| `public/index.html` | Inbox UI (vanilla JS, no build step). |

## Rules that must not be broken

1. **Secrets.** `WASAPFLOW_PARTNER_KEY` and `WASAPFLOW_WEBHOOK_SECRET` live in `.env`
   only. Never commit them, never send them to the browser, never log them. The
   partner key is server-side only; the browser gets a short-lived `connect_url`.
2. **Webhook signature.** Verify `x-wasapflow-signature` (`sha256=` + HMAC-SHA256
   of the **raw** body using the webhook secret) before parsing. Keep
   `express.raw` on the webhook route, registered before `express.json`. Compare
   with `crypto.timingSafeEqual`.
3. **Answer webhooks fast.** Return `200` immediately, then process. Bridge
   counts a reply slower than 10 s as a failure and retries. Deduplicate by
   `message_id`, because the same event can arrive twice.
4. **Number scope.** Number-scoped calls send `x-waba-id` **and**
   `x-phone-number-id`. One WABA can hold several numbers. Key everything by
   `phone_number_id`.
5. **BSUID ≠ phone.** A customer may arrive with a phone, a BSUID
   (`MY.2035200694071263`), or both. Send to the canonical id (phone, else BSUID).
   Never run a BSUID through a phone normaliser, because it turns into a fake
   number. `lib/store.js` → `toPhone()` / `isBsuid()` already guard this; reuse them.
6. **24-hour window.** Free-form messages only reach customers who wrote in the
   last 24 h. Outside the window, use an approved template
   (`POST /messages/template`). Error `131047` means the window has closed.
7. **Coexistence.** `message.echo` is a reply typed on the phone in the WhatsApp
   Business App. Store it as an outbound message. `message.history` is a one-time
   backfill: do not trigger auto-replies, notifications or automations on it.
8. **Errors.** Bridge returns `{ "success": false, "error": { "code", "message", "meta_code" } }`
   with a matching HTTP status. Retry only on 429 and 5xx, and honour `Retry-After`.
9. **Irreversible endpoints** (deregister, delete) need `{"confirm": true}`. Ask
   the human before calling them.
10. **Sending is real.** Every send reaches a real customer and Meta may charge for
    it. Never send test messages to numbers the human did not give you.

## Common tasks

- **Swap storage for Postgres/MySQL/Prisma:** reimplement `lib/store.js` with the
  same exports. Tables: `numbers(phone_number_id pk, waba_id, phone_number, display_name, status, connection_mode)`,
  `contacts(key pk, phone_number_id, id, phone, bsuid, name, unread, last_at, last_inbound_at)`,
  `messages(message_id unique, contact_key, phone_number_id, direction, source, history, type, text, status, error, ts)`.
- **Multi-tenant SaaS:** add a `tenant_id`, pass it as `state` to
  `POST /connect/session`, and map the returned `waba_id` / `phone_number_id` to the
  tenant when the popup posts `WASAPFLOW_CONNECT_SUCCESS`.
- **Media:** incoming media ids are in `data.raw.message[type].id`. Download with
  `GET /contacts/media/:mediaId`. Send with `POST /messages/media`.
- **Templates UI:** `GET /templates` (list, status), `POST /templates` (create).
  Approval arrives as the `template.status_updated` webhook.
- **Interactive buttons/lists, reactions, read receipts, quoted replies:** see
  the "Messages" section of the API reference.
- **Number health:** handle `waba.quality_updated`, `waba.offboarded`,
  `waba.partner_removed`, `waba.reconnected`. Show them to the business owner.
- **Missing messages?** Check `GET /webhooks/failed`, fix the endpoint, then
  `POST /webhooks/retry-all`.

## Billing facts (do not invent others)

WasapFlow Bridge costs $10 USD/month per slot of 3 connected WhatsApp numbers.
The partner account is free, a card is saved first, and nothing is charged until
the first number connects. Meta bills its own message charges directly to each
WABA. There is no SDK; this repo plus the docs is the integration.

WasapFlow Bridge is only a bridge: Meta -> WasapFlow -> this app's webhook, and this
app -> Bridge API -> Meta. WasapFlow has no inbox; this app is the inbox. Numbers
are connected from this app's Connect WhatsApp button (POST /connect/session on the
server); the WasapFlow partner portal has no connect button.
