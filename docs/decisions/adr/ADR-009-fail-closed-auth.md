# ADR-009: Auth fails closed — resolve the owner, and give the origin a front door

**Status:** Accepted — shipped 2026-07-15 (fail-closed reads) and 2026-07-17 (origin guard)
**Deciders:** owner
**Scope:** `editor/lib/auth.js`, `editor/lib/origin-guard.js`, `editor/server.js`, both front-door workers

## Context

The access model ("model C") is: the **demo person (id 1) is public**, the owner's real
CV is gated by a shared `CV_EDITOR_TOKEN`. `tokenAuth` gated all writes, the `/pdf`
compile, and non-public reads.

Two things were wrong with that.

**1. The read gate only matched `/persons/<id>`.** But a person owns more than that
path — every id-addressed resource hanging off them. So:

```
GET /api/variants/:id/resolve   → the ENTIRE resolved CV (name, email, phone, all content)
```

returned a **non-public** person's data with **no token**. Same for `/sections/:id`,
`/entries/:id`, `/items/:id`.

**2. The origin is publicly reachable.** The Cloudflare Access gateway is the intended
front door, but Access cannot cover the Railway URL itself — and that URL
(`cv-production-….up.railway.app`) was verified reachable from the open internet. So #1
wasn't theoretical: it was a live PII exposure, and `CV_EDITOR_TOKEN` was the only thing
standing anywhere in front of the origin.

## Decision

Two layers, both fail-closed.

### 1. Reads are gated on the *owning person*, resolved

`db.ownerPersonId(kind, id)` resolves the owner for **every** id-addressed resource
(`variant`/`section`/`entry`/`item`) with single indexed lookups (JOINs up to
`sections.person_id`). A read is gated unless that owner is on `publicPersonIds`.

Crucially the classifier is **default-deny**: non-person globals (the person LIST,
`/settings`, `/layouts`, `/catalog`, `/health`) are *explicitly* listed as public, and
**anything unrecognized is denied**. A new person-data route cannot silently leak while
nobody is looking.

### 2. The origin only accepts traffic from a front door

`editor/lib/origin-guard.js` requires `X-Origin-Secret`, injected by exactly two front
doors and nothing else:

- the **gateway worker** (cv upstream only; delete-then-set, so a client can't forge it), and
- the **MCP worker** (in `api()`, which also covers the signed `/pdf/<token>` links).

This is defense in depth **on top of** `tokenAuth`, not a replacement.

## Options considered

| Option | Verdict |
|---|---|
| Gate only `/variants/:id` (the leak we found) | **Rejected** — a band-aid. The same bug class returns with the next route. Fail-closed is the structural fix. |
| **Shared-secret header** | **Chosen.** Application-level, portable, fits today's topology (two Cloudflare Workers → a Railway public URL). |
| Railway private networking | **Rejected — impossible.** Both front doors are Cloudflare Workers; they cannot reach Railway's private network. |
| Cloudflare Tunnel (the BFF/gateway target design) | **Deferred.** Strictly better (origin not routable at all) but a much larger project. The shared secret is the 80/20. |
| Timing-safe secret compare | Not used — matches the existing `tokenAuth` (`===`). Network jitter dominates a remote timing attack; revisit if it ever matters. |

## Constraints — do not break these

- **`/health` and `/api/health` MUST stay exempt.** The container HEALTHCHECK hits them
  from `127.0.0.1` with no header. Gating them fails the healthcheck, which fails the
  deploy and flaps the container. (`OPTIONS` is exempt too — CORS preflight.)
- **The secret lives in three places** — Railway env + `wrangler secret put` on both
  workers — and must match **byte-for-byte**. A one-character difference = 403 on
  everything.
- **Roll out injection BEFORE enforcement.** `CV_ORIGIN_SECRET_ENFORCE` selects soft
  (log-only) vs. enforce. Enforcing before the front doors inject is an instant outage.
  Deploy the workers first, watch the soft warnings, *then* flip. Roll back by flipping
  the flag to `false` and redeploying.
- The guard is mounted **after `cors()` and before the body parser**, so a rejected
  request never costs a 2 MB parse.

## Consequences

- A non-public person's data now needs **both** the token *and* the front-door secret.
  A leaked `CV_EDITOR_TOKEN` alone no longer grants direct-origin access.
- New person-data routes are **denied by default** instead of open by default.
- One extra indexed DB lookup per id-addressed read (negligible here; tracked as
  register item 9 if read volume ever grows).
- Three secret copies to keep in sync — the main operational cost, and the thing most
  likely to bite during a rotation.
- Verified live: direct origin → 403 on persons/variants/sections/catalog; health → 200;
  MCP tools and the signed-in editor → work.
