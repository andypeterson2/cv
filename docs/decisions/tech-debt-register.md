# Tech-Debt Register — cv backend + MCP worker

_Last updated: 2026-07-17._

Scope: this repo (`editor/` Express + SQLite backend, `mcp-worker/` Cloudflare
Worker). The **website** repo keeps its own register at
`website/docs/decisions/tech-debt-register.html` (the portal / editor frontend /
API-contract refactor); this one is complementary and does not duplicate it.

Health at a glance: no `TODO`/`FIXME`/`HACK` markers in source; dependencies are
current (Express 5, better-sqlite3 12, wrangler 4.105, MCP SDK 1.29 — nothing
abandoned or vulnerable). The debt below is narrow and mostly cheap.

## Scoring

`Priority = (Impact + Risk) × (6 − Effort)`, each axis 1–5 (effort inverted, so a
low-effort fix scores higher). It's a triage aid, not a law.

## Register

| # | Item | Type | I | R | Eff | Score | Status |
|---|------|------|---|---|-----|-------|--------|
| 1 | `CV_EDITOR_TOKEN` rotation (no longer the *sole* gate — see item 3) + purge `/tmp/cvtok` | Security-ops | 2 | 3 | 1 | 25 | **done** (2026-07-17) |
| 2 | LinkedIn HTTP routes had no integration test | Test | 3 | 3 | 2 | 24 | **done** (2026-07-15) |
| 3 | Harden origin reachability — restrict the Railway origin to our front doors | Infra/Sec | 3 | 4 | 3 | 21 | **done** (2026-07-17) |
| 4 | `test`/`test` cruft entry in person 5's **real** CV (skills id 269) — rendered on export/PDF | Data | 2 | 2 | 1 | 20 | **done** (2026-07-17) |
| 5 | No ADR/decision log in this repo — MCP-worker, auth model, LinkedIn design live only in memory | Docs | 2 | 2 | 2 | 16 | **in progress** (this register seeds it) |
| 6 | Dead `mcp-server/` husk (source retired; only `node_modules/` left) | Cleanup | 2 | 1 | 1 | 15 | **done** (2026-07-15) |
| 7 | No down-migrations / rollback path (migrations run forward-only at boot) | Infra | 1 | 2 | 3 | 9 | open (backlog) |
| 8 | `linkedin_sync.entry_id` has no FK → orphan rows accrue after entry delete/restore | Data | 1 | 1 | 2 | 8 | open (backlog) |
| 9 | Auth gate does a per-request `ownerPersonId` DB lookup (no memoization) | Perf | 1 | 1 | 2 | 8 | open (backlog) |

## Detail

**1 — Token rotation (done).** Rotated by the owner 2026-07-17. It lives in THREE
places and must match byte-for-byte: the Railway env var, and `wrangler secret put
CV_EDITOR_TOKEN` on BOTH the MCP worker and the gateway worker. All three were
verified in sync live — person 5 is non-public, so any read of it requires the token,
and both a `cv_linkedin_status(5)` MCP call and the signed-in editor returned real
data; a missed copy would 401. Item 3 also removed this from being the *sole* gate.
Remaining manual step: delete `/tmp/cvtok` if still present.

**3 — Origin hardening (done).** Both front doors — the api.andypeterson.dev gateway
worker and the MCP worker — now inject `X-Origin-Secret`, and `lib/origin-guard.js`
rejects anything that can't present it (health + OPTIONS exempt; see Recently
resolved). Railway private networking was rejected as an option: both front doors are
Cloudflare Workers, which can't reach Railway's private network — a Cloudflare Tunnel
(the BFF/gateway target design) would be needed for that, which stays the eventual
ideal. This reduces item 1's blast radius: a leaked token alone no longer grants
direct-origin access.

**4 — Real-CV cruft (done).** person 5 ("Andrew Peterson (Clean)") had a skills entry
`{category:"test", skills:"test"}` (id 269) — real data on a real CV that would render
as a "test: test" row in an exported PDF. Deleted 2026-07-17 via `cv_delete_entry`.

**5 — Decision log.** The MCP-worker architecture (stateless-signed OAuth, signed
PDF links), the fail-closed auth model, and the LinkedIn "downstream consumer of
`resolveVariant` + fingerprint drift" design are all ADR-worthy and currently only
in the assistant's memory. This register is step one; a short `adr/` log is step two.

**7–9 — Backlog.** Not urgent; do if you're already in that code. (7) a bad
migration can't be auto-rolled back — acceptable for a single-owner DB with
snapshots, but note it. (8) an `entry_id` FK with `ON DELETE CASCADE` would
auto-clean orphans, but was intentionally omitted so a restore doesn't silently wipe
sync state; revisit if orphans matter. (9) memoize the owner lookup per request if
read volume ever grows.

## Phased plan

- **Phase 1 — quick wins:** items 1, 2, 4, 6 **all done**.
- **Phase 2 — real hardening:** item 3 (origin) **done**; item 5 (ADR log) still open —
  this register exists, the `adr/` entries don't yet.
- **Phase 3 — backlog / do-if-touched:** items 7–9.

## Recently resolved

- **2026-07-17 — the origin is no longer open to the internet** (`ec4b216`, enforced
  via `CV_ORIGIN_SECRET_ENFORCE=true`). The Railway origin is publicly reachable, so
  tokenAuth was the only thing in front of it. Now both front doors inject
  `X-Origin-Secret` (gateway: cv-only, delete-then-set so a client can't forge it; MCP:
  in `api()`, which also covers signed /pdf links) and `lib/origin-guard.js` rejects
  everything else — `/health` + `/api/health` exempt (the container HEALTHCHECK hits
  them from 127.0.0.1) and OPTIONS exempt (preflight). Rolled out in two stages (soft
  → enforce) so the doors were injecting before the gate closed. Verified live:
  direct origin → 403 on persons/variants/sections/catalog, health → 200, MCP tools →
  work, signed-in editor → renders. Note for future rollouts: two builds failed inside
  an upstream GitHub outage (Railway incident 8BVRVAAM) — a build dying at "unpacking
  archive" with no Dockerfile steps is platform-side, not your code.

- **2026-07-15 — PII leak on ungated reads** (`a050f36`). `tokenAuth` gated
  non-public reads only on `/persons/<id>` paths, so `GET /api/variants/:id/resolve`
  (and `/sections`, `/entries`, `/items`) returned a non-public person's full CV with
  no token, on a directly-reachable origin. Fixed fail-closed: the owning person is
  resolved for every id-addressed resource (`db.ownerPersonId`) and gated unless
  public; unrecognized reads are denied by default. Verified live (person 5 → 401,
  demo person 1 → 200).
