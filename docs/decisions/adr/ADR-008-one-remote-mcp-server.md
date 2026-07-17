# ADR-008: One remote MCP server, with stateless-signed OAuth

**Status:** Accepted — decided 2026-06-27, shipped 2026-07-04 (live at `mcp.andypeterson.dev`)
**Deciders:** owner
**Scope:** `mcp-worker/`

## Context

The cv editor's agent surface was a **stdio MCP server** (`mcp-server/server.mjs`): a
local Node process, launched by the client. Two problems:

1. **One machine only.** stdio reaches Claude Desktop on the box it runs on. Not the
   web client, not mobile.
2. **Credentials on disk.** It held a copy of the backend token locally.

We wanted one server reachable from every Claude client, with the credential surface
as small as possible.

## Decision

A **single remote MCP server as a Cloudflare Worker** (`mcp-worker/`), and the stdio
server is **retired** (deleted once live parity was verified — its husk was finally
removed 2026-07-15).

- `McpAgent` (Durable Object, binding `MCP_OBJECT`) mounts the `cv_*` catalog on the
  low-level MCP `Server` via the same `ListTools`/`CallTool` handlers the stdio server
  used — so the tools were **moved, not forked**.
- `OAuthProvider` wraps `/mcp`; a Google-OAuth **proxy** handler (`src/oauth-google.ts`)
  gates login to `ADMIN_EMAILS`.
- Tools reach the cv backend over HTTP with `Authorization: Bearer CV_EDITOR_TOKEN`
  (and, since ADR-009, `X-Origin-Secret`).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **A. Keep stdio** | simple; no OAuth | one machine; no web/mobile; credential on disk |
| **B. Remote Worker** *(chosen)* | one server, all clients; secrets in Worker store; small surface | OAuth complexity; Workers runtime constraints |
| **C. Run both** | migration safety net | two catalogs → drift; two credential copies |

C was rejected deliberately: the tools were *moved*, so there is exactly one catalog.
Keeping stdio alive would have guaranteed drift.

## Workers-forced divergences

The runtime dictated two changes — worth knowing before "fixing" them:

- **ajv → `@cfworker/json-schema`.** ajv compiles schemas with `new Function`, which
  workerd forbids. `@cfworker` is a zero-eval interpreter.
- **`cv_get_pdf` returns a link, not bytes.** A Worker has no filesystem. It returns a
  signed, short-lived `/pdf/<token>` URL; the Worker verifies the HMAC and streams the
  PDF from the backend. (Delivering it *inline* as a base64 resource was tried first —
  **Claude's connector rejects it**: MCP result-schema validation, a format problem, not
  a size one. The tiny demo PDF failed identically.)

## The expensive gotcha: OAuth state must be stateless-signed

**Not cookies. Not KV.** Two failed connect attempts, in order:

1. A `__Host-` CSRF cookie → *"CSRF token mismatch"*. Cookies don't survive Claude's
   OAuth popup.
2. A one-time KV `consent_id` → *"Consent expired or invalid"*. **KV is eventually
   consistent** — the consent GET's write isn't readable on the POST ~3s later. Worse,
   it **passes locally**, because Miniflare's KV is synchronous: a textbook
   works-local-fails-prod.

**The fix:** carry the parsed auth request in an HMAC-signed token (`mintToken`/
`readToken`, key = `COOKIE_SECRET || GOOGLE_CLIENT_SECRET`) embedded in both the consent
form field and the Google `state`. Fully stateless — no cookie, no KV read-after-write.
The same signing helper (`src/sign.ts`) backs the PDF links.

Do not reintroduce cookies or KV round-trips into this flow.

## Consequences

- One server serves web + desktop + mobile; credentials live only in Worker secrets.
- One tool catalog → no drift.
- **A secret now lives in three places** (Railway env + both workers' `wrangler secret
  put`) and must match byte-for-byte. See ADR-009.
- The Workers runtime constrains the toolchain (no eval, no filesystem) — assume any
  Node-shaped library needs checking before use.
- Hardened separately: a default-deny path allowlist in `src/index.ts` (only `/mcp`,
  `/authorize`, `/callback`, `/token`, `/register`, `/.well-known/*` reach the app —
  everything else 404s before OAuth logic runs) plus a rate limiter on the OAuth
  endpoints only.
