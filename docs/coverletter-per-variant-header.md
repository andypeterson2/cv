# Design — per-variant cover-letter headers

> **Status:** proposed · **Scope:** cv backend (Express + SQLite) + the portal's editor frontend
> · **Effort:** ~½–1 day · **Risk:** low, but touches live data.

## Problem

A cover letter's **paragraphs** are stored per-variant, but its **header** — recipient,
address, salutation, closing — is stored per-**person**. So two `coverletter` variants on the
same person (two letters to two companies) render with the *same* recipient. It's an asymmetry,
not a missing feature: paragraphs got normalized, the header didn't.

```
CURRENT                                    persons
                                        ┌────┴─────┐
                        settings (KV)   │          │   variants  (kind: cv | resume | coverletter)
                    coverletter.*  ◄────┘          └────┐   │
                    per-PERSON  ✗ SHARED                 │   ├── variant_rules
                                                         │   └── variant_letter_sections  ✓ per-VARIANT
                                                         │        (paragraphs)
```

- Header: `settings` rows `coverletter.*`, keyed by person — `getCoverletterHeader(personId)`
  (`editor/lib/db/settings.js:56`), written by `PATCH /persons/:pid/coverletter`
  (`editor/routes/persons.js:97`).
- Paragraphs: `variant_letter_sections`, keyed by `variant_id` — already correct.

**Fix:** make the header per-variant, matching the paragraphs.

## Requirements & assumptions

**Functional**
- Each `coverletter` variant owns its header; reads/writes target the variant.
- Existing letters keep their current header — the migration is visually a no-op.

**Non-functional — the part that actually shapes this design.** This is a **single-user personal
tool** (real CV data lives in prod, persons 1/3/18). There is no scale, concurrency, or caching
problem. The only real risks are:

1. **Zero data loss** on a live SQLite DB holding a real CV.
2. **No broken window** across two independently-deploying tiers — the cv backend (Railway,
   auto-deploys after CI) and the portal frontend (GitHub Pages, its own CI). They don't land
   atomically.

**Constraints:** `better-sqlite3` with numbered migration files; the API contract + its live
contract tests (`tests/contract/`); the frontend's `LetterController` abstraction.

**Header fields (fixed set):** `recipientName`, `recipientAddress`, `opening`, `closing`.
(The sender / signoff is derived from `personal.*`, not part of the header.)

## Design

### Storage — a dedicated 1:1 table, sibling to the paragraphs table

```sql
CREATE TABLE variant_letter_header (
  variant_id        INTEGER PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  recipient_name    TEXT NOT NULL DEFAULT '',
  recipient_address TEXT NOT NULL DEFAULT '',
  opening           TEXT NOT NULL DEFAULT '',
  closing           TEXT NOT NULL DEFAULT ''
);
```

```
TARGET          variants (coverletter)
                   │            │
              1:1  │            │  1:N
       variant_letter_header    variant_letter_sections
       (recipient, opening,      (paragraphs)
        closing) ✓ per-VARIANT
```

| Option | Verdict |
|---|---|
| **1:1 typed table** (chosen) | Mirrors `variant_letter_sections` exactly; cascade-deletes with the variant; explicit columns. Header is four fixed fields, so typed beats key-value. |
| Columns on `variants` | Rejected — kind-specific nullable columns on a table shared by cv/résumé variants. |
| Per-variant KV (`variant_settings`) | Reuses the `stripPrefix('coverletter.')` machinery and is future-proof, but over-flexible for four fields. The fallback if per-variant letter settings (letterhead, date) ever proliferate. |

### API — mirror the letter-sections shape already on the variant

- `GET /variants/:id` already returns `letterSections` for coverletter kind
  (`editor/routes/variants.js:55`) — **add `header`** there, so one fetch loads both.
- `PATCH /variants/:id/header` — the per-variant write, sibling to
  `PATCH /variants/:id/letter-sections/order`.

## Migration & rollout — expand → migrate → contract

A data-model change on a live two-tier system wants three independently-safe deploys, never a
big-bang. At no point do the running frontend and backend disagree.

```
DEPLOY 1 · backend EXPAND  (purely additive — old frontend keeps working)
  + migration 011: CREATE TABLE variant_letter_header
  + BACKFILL: for each coverletter variant, copy its person's coverletter.* header in.
             (a person's letters share it today → copy to EACH, so nothing changes visually)
  + GET /variants/:id now includes `header`;  + PATCH /variants/:id/header
  + render/compile path reads getVariantHeader(variantId)   (safe: backfill made them equal)
  ✓ KEEP the old path live: master still returns `coverletter`; PATCH /persons/:pid/coverletter still writes
        └─ old frontend reads/writes the person-level header exactly as before

DEPLOY 2 · frontend SWITCH  (backend supports BOTH paths, so this can't break)
  LetterController gains `header = $state({})`; load() fetches header+sections per variant;
  saveHeader(key) → PATCH /variants/:id/header;  LetterEditor binds editor.letters.header
  └─ person.coverletter usage removed from the letter UI

DEPLOY 3 · backend CONTRACT  (cleanup, only after the frontend is live & verified)
  − drop `coverletter` from the master response
  − remove PATCH /persons/:pid/coverletter
  − delete the now-orphaned coverletter.* person settings
```

**Pragmatic shortcut (recommended here):** because it's one user, the compat window is
"don't edit a cover letter during the ~5-minute deploy overlap" — cheap to just honor. So this
can collapse to **Deploy 1 (expand + keep compat) → Deploy 2 (frontend) → fold the contract
cleanup into a later commit**. Keep the **backfill-before-switch ordering** either way — that's
the part that protects the data, and it's non-negotiable.

**Backfill edge cases**
- Person with header settings but *no* coverletter variant → header is unreachable; drop it.
- Migration is idempotent + reversible: the down path drops the table; person `coverletter.*`
  settings are only deleted in Deploy 3, so Deploys 1–2 roll back cleanly.

## Frontend changes (portal — `src/editor/`)

- `LetterController` (`lib/letters.svelte.ts`): add `header = $state<Record<string,string>>({})`;
  `load()` populates it from `GET /variants/:id`; `saveHeader(key)` debounces
  `PATCH /variants/:id/header`.
- `LetterEditor.svelte`: bind `editor.letters.header.recipientName` (etc.) instead of
  `editor.person.coverletter`.
- Drop the `coverletter()` thunk from `LetterHost` — the controller owns the header now, exactly
  as it owns `sections`. This shrinks the host (on-trend with the store split).

## One contract ripple to not miss

JSON **import/export** carries the header at person level (`editor/lib/db/import-export.js:74`)
and paragraphs per variant (`:65`). Post-migration the header must nest **inside each coverletter
variant** in the export shape (`variant.header`). That's a versioned-contract change touching
`buildExport`/import on both sides and the contract schemas — land it with Deploy 1, and keep
emitting the person-level `coverletter` during expand for back-compat.

## Trade-offs & what to revisit

- **Typed table vs KV** — chose typed for four fixed fields; revisit → KV if per-variant letter
  settings multiply.
- **3-deploy vs 2-deploy** — the single-user context earns the shortcut, but the
  backfill-before-switch ordering is kept regardless. If this ever went multi-user, the compat
  window stops being ignorable and you'd want a real API version bump + a feature flag.
- **Effort** — ~½–1 day, dominated by the backfill migration + the export-contract change, not
  the CRUD.
