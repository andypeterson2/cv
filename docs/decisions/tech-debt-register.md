# Tech-Debt Register — cv backend + MCP worker

_Last updated: 2026-07-15._

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
| 1 | `CV_EDITOR_TOKEN` is the **sole** gate on a publicly-reachable origin — confirm rotated + purge `/tmp/cvtok` | Security-ops | 2 | 3 | 1 | 25 | **open** (owner) |
| 2 | LinkedIn HTTP routes had no integration test | Test | 3 | 3 | 2 | 24 | **done** (2026-07-15) |
| 3 | Harden origin reachability — restrict the Railway origin to the gateway (shared-secret header / private networking) | Infra/Sec | 3 | 4 | 3 | 21 | **open** |
| 4 | `test`/`test` cruft entry in person 5's **real** CV (skills id 269) — renders on export/PDF | Data | 2 | 2 | 1 | 20 | **open** (owner) |
| 5 | No ADR/decision log in this repo — MCP-worker, auth model, LinkedIn design live only in memory | Docs | 2 | 2 | 2 | 16 | **in progress** (this register seeds it) |
| 6 | Dead `mcp-server/` husk (source retired; only `node_modules/` left) | Cleanup | 2 | 1 | 1 | 15 | **done** (2026-07-15) |
| 7 | No down-migrations / rollback path (migrations run forward-only at boot) | Infra | 1 | 2 | 3 | 9 | open (backlog) |
| 8 | `linkedin_sync.entry_id` has no FK → orphan rows accrue after entry delete/restore | Data | 1 | 1 | 2 | 8 | open (backlog) |
| 9 | Auth gate does a per-request `ownerPersonId` DB lookup (no memoization) | Perf | 1 | 1 | 2 | 8 | open (backlog) |

## Detail

**1 — Token rotation.** The 2026-07-15 auth fix (see Recently resolved) made the
token gate *correct*, but it's the only thing in front of a directly-reachable
origin. Memory has long flagged "ROTATE it" (it lived in `/tmp/cvtok`). If it was
ever exposed, that's a single point of total exposure. Rotate on Railway + the
worker secret (`wrangler secret put CV_EDITOR_TOKEN`) and delete `/tmp/cvtok`.

**3 — Origin hardening.** Upgrades the model from "public origin, well-gated" to
"not publicly reachable." The gateway would inject a shared secret the backend
requires, or the backend moves to Railway private networking so only the gateway
can reach it. This is the durable fix behind item 1.

**4 — Real-CV cruft.** person 5 ("Andrew Peterson (Clean)") has a skills entry
`{category:"test", skills:"test"}` (id 269). It's real data on a real CV — it would
render as a "test: test" skill row in an exported PDF. Delete it in the editor.

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

- **Phase 1 — quick wins:** items 2, 6 **done**; 1 & 4 are owner actions (token, data).
- **Phase 2 — real hardening:** item 3 (origin) + finish item 5 (ADR log).
- **Phase 3 — backlog / do-if-touched:** items 7–9.

## Recently resolved

- **2026-07-15 — PII leak on ungated reads** (`a050f36`). `tokenAuth` gated
  non-public reads only on `/persons/<id>` paths, so `GET /api/variants/:id/resolve`
  (and `/sections`, `/entries`, `/items`) returned a non-public person's full CV with
  no token, on a directly-reachable origin. Fixed fail-closed: the owning person is
  resolved for every id-addressed resource (`db.ownerPersonId`) and gated unless
  public; unrecognized reads are denied by default. Verified live (person 5 → 401,
  demo person 1 → 200).
