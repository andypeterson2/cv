# cv-mcp — remote MCP server for the cv editor

A Cloudflare Worker that exposes the cv editor's REST API as **61 `cv_*` MCP tools**
over MCP Streamable-HTTP, behind **Google OAuth** (admin-only). This is the **single**
MCP server — it supersedes the local stdio `../mcp-server` (deleted once parity is
verified). Use it from Claude on web, desktop, **and** mobile by adding it as a
custom Connector.

```
Claude (web/desktop/mobile) ──OAuth 2.1 (PKCE+DCR)──▶ cv-mcp Worker ──X-Origin-Secret + Access token──▶ cv on Railway (via tunnel)
                                                        (Google login → ADMIN_EMAILS gate)
```

## Layout
- `src/tools.ts` — the 61 tools + `api()` REST helper + `@cfworker/json-schema` validation (moved from `../mcp-server/server.mjs`).
- `src/mcp.ts` — `CvMcp` (McpAgent / Durable Object); mounts the tools on the low-level MCP `Server`.
- `src/oauth-google.ts` — the Google OAuth *proxy* (consent + CSRF + state + `ADMIN_EMAILS` gate).
- `src/index.ts` — `OAuthProvider` wrapping `/mcp`.

## Local dev
```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest (runs in workerd): 61 tools + validators
npm run build            # wrangler deploy --dry-run (bundle check)
npm run dev              # wrangler dev — boots the Worker locally
```
`wrangler dev` runs the same Worker locally; Claude Code can point at the local `/mcp`
endpoint, which is why the stdio server is no longer needed.

## Deploy (OWNER)

**Cost: $0.** Runs on the Workers **Free** plan — SQLite-backed Durable Objects are free-tier, and custom Claude connectors work on Free (1 connector) / Pro / Max. No paid plan required.

**⚠️ Do NOT put `mcp.andypeterson.dev` behind Cloudflare Access.** Claude connects from Anthropic's cloud; Access (or an IP rule) would block it. This Worker's OWN Google OAuth + `ADMIN_EMAILS` is the gate — that's the point.

Prereqs: Node 22 (`nvm use 22`), `wrangler login`, and the `andypeterson.dev` zone on your Cloudflare account.

### 1. Google OAuth app (get the client id/secret)
Google Cloud Console → **Google Auth Platform**:
- **Branding**: User type **External**, app name, your support email.
- **Data Access** → add scopes `openid`, `email`, `profile` (all *non-sensitive* → no Google verification review).
- **Audience** → **Publish app** (instant with only non-sensitive scopes). *(Staying in "Testing" also works — non-sensitive scopes are exempt from the usual 7-day token expiry. Either way, the real gate is `ADMIN_EMAILS` in the Worker.)*
- **Clients** → **Create client** → **Web application** → Authorized redirect URI = **exactly** `https://mcp.andypeterson.dev/callback` (optionally also `http://localhost:8799/callback` for `wrangler dev`). Leave "Authorized JavaScript origins" empty. Copy the **Client ID** + **Client secret** (the secret is shown only once).

### 2. Cloudflare config
- **KV**: `wrangler kv namespace create OAUTH_KV` → paste the id into `wrangler.jsonc` (`kv_namespaces[0].id`).
- **Vars**: confirm `CV_EDITOR_URL` and `MCP_PUBLIC_URL` in `wrangler.jsonc`. Every deploy replaces the Worker's vars with these, so a var set only in the dashboard is lost on the next deploy. (`ADMIN_EMAILS` is a secret, set in step 4, so your address stays out of this public repo.)
- **Custom domain**: add to `wrangler.jsonc` — `"routes": [{ "pattern": "mcp.andypeterson.dev", "custom_domain": true }]` (Cloudflare auto-creates the proxied DNS record + cert on deploy).

### 3. The front-door credentials for cv
- Generate a `CV_ORIGIN_SECRET`, set it on the Railway **cv** service env, and use the same value for the Worker secret below (both sides must match).
- Zero Trust → Access → **Service Auth** → create a service token for cv's tunnel host (`cv-origin.andypeterson.dev`) and allow it in that host's Access policy. Its client id and secret become `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.

### 4. First deploy, then set secrets
This one-time bootstrap runs from your machine; after it, CI deploys (step 7).
```bash
wrangler deploy                          # creates the Worker + applies the v1 DO migration + binds the domain
wrangler secret put CV_ORIGIN_SECRET     # = the Railway value
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put ADMIN_EMAILS         # your Google address; comma-separated for more
wrangler secret put COOKIE_SECRET        # recommended: the HMAC key that signs the OAuth state tokens (else falls back to GOOGLE_CLIENT_SECRET)
```
(Secrets need the Worker to exist, so deploy first; each `secret put` ships a new version. Later deploys keep them.)

### 5. Verify it serves
```bash
curl -s https://mcp.andypeterson.dev/.well-known/oauth-protected-resource   # 200 JSON
curl -s -o /dev/null -w "%{http_code}\n" https://mcp.andypeterson.dev/mcp   # 401 (gated)
```

### 6. Connect Claude
**Customize → Connectors → "+" → Add custom connector** → URL `https://mcp.andypeterson.dev/mcp` → leave the OAuth client fields blank (the server self-registers via DCR) → **Add** → complete the Google sign-in popup (an allowlisted email succeeds; others are denied). Add it on **web**; it then syncs to **desktop + mobile** (mobile install is beta — add on web, use on mobile).

### 7. Continuous deploy
Every push to `main` that passes CI deploys the Worker (the `deploy-mcp-worker` job in `.github/workflows/ci.yml`), using the wrangler version pinned in `package-lock.json`, then smoke-checks the two URLs from step 5. **Actions → CI → Run workflow** redeploys `main` on demand. One-time setup:
- **API token**: Cloudflare dashboard → My Profile → API Tokens → **Create Token** → the **Edit Cloudflare Workers** template. Restrict *Account Resources* to your account and *Zone Resources* to `andypeterson.dev`.
- **Environment**: repo **Settings → Environments → New environment** `production`. Under *Deployment branches and tags* choose **Selected branches** → `main`. Add two environment secrets:
  - `CLOUDFLARE_API_TOKEN` = the token above;
  - `CLOUDFLARE_ACCOUNT_ID` = the id on the Workers & Pages overview page.

The Worker's own secrets (step 4) stay in Cloudflare; CI never sees them.

**Rollback** (it takes seconds and serves an earlier uploaded version again):
```bash
npx wrangler versions list                 # find the last good version id
npx wrangler rollback <version-id> -y
```
Then revert the offending commit on `main`, or the next deploy ships it again.

## Verify (post-deploy)
- **Auth**: connecting with an allowlisted Google account succeeds; a non-allowlisted account is denied. Tokens are never exposed to the client.
- **Tools**: the connector lists 61 tools; `cv_get_main` returns your CV; `cv_get_pdf` returns an inline PDF.
- **Mobile**: same connector works in the Claude mobile app.

## Hardening — default-deny allowlist + rate limiting
The Worker serves ONLY these paths; every other request (the constant `.env` / `.git` / `.aws` / `wp-admin` credential-scanner traffic that finds every new hostname via Certificate Transparency logs) gets a uniform 404 **before any OAuth logic runs**:
- `/mcp` (+ sub-paths) — the MCP endpoint
- `/authorize`, `/callback`, `/token`, `/register` — the OAuth 2.1 endpoints
- `/.well-known/*` — OAuth/OIDC discovery metadata
- `/pdf/<token>` — signed, short-lived PDF download links (served directly, not via OAuth)

Enforced in `src/index.ts` (`isAllowedPath`) — defense in depth that holds even without an edge rule. Mirror it at the Cloudflare edge (Dashboard → zone → **Security → WAF → Custom rules**, action **Block**) to drop the junk before it costs a Worker invocation:
```
(http.host eq "mcp.andypeterson.dev" and not (
  http.request.uri.path eq "/mcp" or
  starts_with(http.request.uri.path, "/mcp/") or
  starts_with(http.request.uri.path, "/pdf/") or
  http.request.uri.path in {"/authorize" "/callback" "/token" "/register"} or
  starts_with(http.request.uri.path, "/.well-known/")
))
```
The allowed set is exactly what Claude + the OAuth flow use, so legit MCP traffic is never blocked or challenged (important — Claude's client can't solve a CAPTCHA). Optionally also enable **Security → Bots → Bot Fight Mode**. Note: `/register` (DCR) + `/authorize` are intentionally public — the real access gate is the Google login + `ADMIN_EMAILS` at `/callback`, so a probe that registers a client still dead-ends there.

**Rate limiting (in-Worker, plan-independent).** The OAuth endpoints (`/authorize`, `/callback`, `/token`, `/register`) are throttled to **30 requests / 60s per client IP** (Cloudflare's `CF-Connecting-IP`, which clients can't spoof) via the native Workers rate-limit binding — `OAUTH_RATE_LIMITER` in `wrangler.jsonc`, enforced in `src/index.ts`; over the limit → `429`. `/mcp` (token-gated + legitimately chatty) and `/.well-known/*` (discovery Claude must reach) are deliberately **not** limited. It's per-colo / best-effort (fine for blunting a hammering source, not precise accounting). Tune the numbers in `wrangler.jsonc` → `ratelimits[0].simple`.

## Known divergences from the stdio server (intentional, Workers-forced)
- **`cv_get_pdf`** returns a **signed, short-lived download link** (`/pdf/<token>` — the Worker streams the PDF from the cv backend when opened) instead of writing to a local path (no Worker filesystem) or inlining a base64 blob (Claude's connector rejects inline PDF resources).
- **`cv_install_layout`** is **unavailable** remotely (it reads a local `.zip`); it returns a clear error. Install layouts from a local dev session.
