# WhatsApp CRM Starter: official WhatsApp Business API in your own app

A minimal, working WhatsApp CRM on the **official WhatsApp Business API (Meta Cloud API)**
through [WasapFlow Bridge](https://partner.wasapflow.com/bridge/what-is-wasapflow-bridge).
You don't need to become a Meta Tech Provider or go through Meta App Review. Clone it and
run it, then let your AI (Claude Code, Cursor, Codex, Copilot) grow it into your CRM or SaaS.

It's about 400 lines of Node.js across four files, with two dependencies and no build step.

**What it does**

- **Connect WhatsApp** button. Your client connects their number through Meta Embedded Signup.
  **Coexistence** is supported, so the business can keep using the WhatsApp Business app on
  their phone.
- **Signed webhooks.** Incoming messages, delivery and read status, replies typed on the phone
  (`message.echo`), and chat history backfill (`message.history`).
- **Inbox.** Conversations, unread counts, the 24-hour window, and text or template replies.
- **Multi-number.** Everything is keyed by `phone_number_id`.
- **BSUID-safe contacts.** WhatsApp usernames don't break your phone field.
- **`AGENTS.md`, `CLAUDE.md` and `.cursor/rules`.** These tell your AI exactly how the
  integration works, so what it builds on top stays correct.

## Run it in 5 minutes

1. **Partner account.** Create a free account at https://partner.wasapflow.com/bridge/partner/register
   and save a card. Nothing is charged until the first number connects. After that, Bridge costs
   **$10/month for every 3 WhatsApp numbers**, and Meta bills message charges directly.
   WasapFlow Bridge is only the bridge to Meta: this app is your inbox, and numbers
   are connected from its own **Connect WhatsApp** button (the WasapFlow portal has no connect button).
2. **Install:**
   ```bash
   git clone https://github.com/kobaranteguh/whatsapp-crm-starter.git
   cd whatsapp-crm-starter
   npm install
   cp .env.example .env
   ```
3. **Keys.** Open portal → **Integration** and copy the Partner Key and Webhook Secret into `.env`.
4. **Public URL for webhooks.** Deploy the app (Railway, Render, Fly, a VPS), or tunnel your
   local machine (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`).
   In portal → **Integration**, save the webhook URL as `https://<your-domain>/webhook/wasapflow`.
5. **Start:**
   ```bash
   npm start
   ```
   Open http://localhost:3000 (user `admin`, password = `ADMIN_PASSWORD`), click
   **+ Connect WhatsApp**, then message that number from your phone.

## Build the rest with your AI

Open the folder in your AI tool and paste one of these prompts:

> Read AGENTS.md and the WasapFlow Bridge API reference. Replace lib/store.js with Postgres using Prisma, keeping the same exports. Add migrations.

> Read AGENTS.md. Make this multi-tenant: users sign up, each tenant connects its own WhatsApp numbers via POST /connect/session with state = tenant id, and only sees its own inbox.

> Read AGENTS.md and the Bridge docs. Add media: show incoming images and documents, and let agents send images from the composer.

> Read AGENTS.md. Add a templates page: list templates with status, create new ones, and refresh on the template.status_updated webhook.

> Read AGENTS.md. Add assignment and tags: assign a conversation to a staff member, tag it, and filter the inbox by tag.

**Give your AI live access (optional).** The WasapFlow MCP server lets it search the docs
and call your Bridge account, for example to list numbers, check failed webhooks, or send a
test message.

```bash
claude mcp add --transport http wasapflow https://officialapi.wasapflow.com/bridge/mcp --header "x-partner-key: wf_..."
```

```json
{ "mcpServers": { "wasapflow": { "url": "https://officialapi.wasapflow.com/bridge/mcp", "headers": { "x-partner-key": "wf_..." } } } }
```

## Files

| File | What it is |
|---|---|
| `server.js` | Webhook receiver (signature check, events), `/api/*`, Basic auth |
| `lib/bridge.js` | The only module that calls Bridge (plain `fetch`, no SDK) |
| `lib/store.js` | JSON-file storage that you can replace with your database |
| `public/index.html` | Inbox UI |
| `AGENTS.md` | Rules and recipes for AI coding tools |

## Links

- API reference (Markdown, for AI tools): https://raw.githubusercontent.com/kobaranteguh/api/main/README.md
- Partner guide: https://raw.githubusercontent.com/kobaranteguh/guide/main/README.md
- OpenAPI 3.1: https://officialapi.wasapflow.com/bridge/openapi.json
- Postman: https://www.postman.com/ustazzul/workspace/wasapflow-bridge-api
- Docs: https://partner.wasapflow.com/bridge/docs

## FAQ

**Do I need a Meta Business verification or app review?** You don't need Meta App Review or
Tech Provider status; Bridge provides both. Each business connects its own number through
Meta's Embedded Signup from your app's Connect WhatsApp button and must follow WhatsApp's policies.

**Can a business keep using WhatsApp on their phone?** Yes. With Coexistence, replies typed on
the phone show up in this inbox as `message.echo`.

**Is this production-ready?** The integration patterns are: signature check, deduplication,
BSUID handling, multi-number, and the 24-hour window. The JSON-file storage and Basic auth are
not. Swap them in for your stack (see the prompts above).

MIT licensed. © Kobaran Teguh Sdn. Bhd.
