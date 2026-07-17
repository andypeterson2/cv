# ADR-010: LinkedIn is a downstream consumer; the fingerprint is the product

**Status:** Accepted — shipped 2026-07-15
**Deciders:** owner
**Scope:** `editor/lib/linkedin.js`, `editor/lib/db/linkedin.js`, migration `015_linkedin_sync.sql`, `editor/routes/persons.js`, `mcp-worker/src/tools.ts`

## Context

Keeping LinkedIn / Indeed / Handshake in step with the CV is manual, and the failure
mode is **forgetting whether an edit was mirrored** — not the typing.

Sync-by-API is not available to an individual:

- **LinkedIn** — a Profile Edit API exists (`POST /v2/people/id={id}/positions`) but is
  gated to approved partners under a data agreement. Not obtainable.
- **Indeed** — developer APIs are employer/ATS-side. No job-seeker profile write.
- **Handshake** — no public student API (they removed even the résumé parser).

UI automation would violate ToS. So sync is out.

## Decision

The **CV stays the source of truth**; we generate paste-ready blocks and **detect
drift**. Built as a **downstream consumer of `resolveVariant`** — zero changes to the
content model.

Explicitly **not**:
- a new variant `kind` — that's a closed enum (`cv | resume | coverletter`);
- a new layout — layouts are LaTeX bundles that compile to PDF.

A "linkedin" kind or layout would break both contracts to model something that is
neither a document nor a typesetting target.

**Surface:** one table (`linkedin_sync`) + three tools:
`cv_export_linkedin` · `cv_linkedin_status` · `cv_linkedin_mark_synced`.

**The fingerprint is the point.** Formatting is the easy 10%; `cv_linkedin_status`
compares each position's current fingerprint against what was last pasted and reports
`synced | drifted | new` — naming exactly which positions are stale.

## The field mapping was VERIFIED, not assumed

The design handoff's mapping was **wrong**, and would have shipped broken output. What
the real resolved data says:

| Field | Reality | The assumption it broke |
|---|---|---|
| company | **`fields.organization`** | assumed `fields.title` — experience entries have **no** `title` → every company blank |
| role | `fields.position` | (correct) |
| dates | `"July 2022 -- December 2024"` — **full month names, LaTeX `--`** | a single-hyphen split → **every end date dropped** |
| content | carries LaTeX: `---`, `\%`, `\textrightarrow{}`, `~` | naive cleanup → LaTeX leaks into the paste |

**The lesson:** resolve a real variant and read the actual keys before trusting any
mapping doc — including this one.

## Design details worth keeping

- **The fingerprint is computed over normalized, glyph-free values.** Switching `format`
  must never read as drift; only real content changes may. (Hashing the bulleted
  description — as first designed — would have made every format switch look like drift.)
- **`format` is an argument, not three exporters** (`linkedin` `•` / `plaintext` /
  `markdown` `-`). One exporter, three consumers: Indeed and Handshake take the same
  title/company/dates/description shape.
- **Routes are person-scoped** (`/api/persons/:pid/linkedin*`) **on purpose.** `tokenAuth`
  keys its read-gate on `/persons/<id>`, so a variant-scoped route would have been
  **ungated** — see ADR-009. The variant rides as a parameter.
- **`overLimit` is surfaced**, not enforced: LinkedIn silently truncates position
  descriptions at ~2000 chars. Better to warn before the paste than lose the tail after.
- Year-only ranges → `month: null`; "Present"/"Current" → `end: null` ("I currently work
  here").

## Consequences

- Zero content-model change; the exporter is pure and unit-tested against real resolved
  JSON.
- After any edit, `cv_linkedin_status` names exactly which positions are stale.
- **Sync state is keyed `(person_id, entry_id)`** — an import/restore re-creates entries
  with new ids, so sync resets to `new` even if the content is identical. Accepted;
  restores are rare (register item 8).
- **Export and status must use the same variant** to be meaningful. Both default to the
  person's `cv`-kind variant.
- Only the fingerprint is stored, never the exported text — the CV remains the single
  source of truth.
