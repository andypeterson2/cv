# cv-editor MCP server

A [Model Context Protocol](https://modelcontextprotocol.io/) stdio server that
exposes the cv-editor REST API as typed tools. Lets MCP-aware AI assistant
clients (Claude Code, Cline, Continue, etc.) read and edit profiles, tag
content, build resume/CV/cover-letter variants, and compile PDFs as first-class
tool calls.

**Stateless and id-addressable.** There is no "active person" and no switch —
every tool takes the ids it operates on, and ids are stable. The natural flow
is: `cv_get_master` once → edit/tag by id → define a variant by tag rules →
`cv_resolve_variant` to preview → `cv_get_pdf`.

## Tools exposed

| Tool | Effect |
|------|--------|
| `cv_health` | Ping the backend; returns `{status, service, persons}`. |
| `cv_list_persons` | List profiles `{persons:[{id,name,created_at}]}`. |
| `cv_get_master` | A person's full master CV with stable ids (sections→entries→items + tags), variants, and tag vocabulary. The canonical read. |
| `cv_create_person` / `cv_delete_person` | Profile lifecycle. |
| `cv_set_personal` | Update personal info fields (string values). |
| `cv_add_section` / `cv_update_section` / `cv_delete_section` | Section CRUD (by id; slug is kebab-case, unique per person). |
| `cv_add_entry` / `cv_update_entry` / `cv_delete_entry` | Entry CRUD (by id). |
| `cv_add_bullet` / `cv_update_bullet` / `cv_delete_bullet` | Bullet CRUD (by id). |
| `cv_tag` / `cv_untag` | Add/remove free-string tags on an entry or bullet. Tags drive variant inclusion. |
| `cv_list_variants` / `cv_get_variant` | List variants / read one variant's rules + sections + overrides. |
| `cv_create_variant` / `cv_delete_variant` | Variant lifecycle. `kind` ∈ cv / resume / coverletter. |
| `cv_set_variant_rules` | Set a variant's tag query (`include` / `exclude`). No rules = the full master. |
| `cv_set_variant_sections` | Set which sections appear in a variant + their order/enabled. |
| `cv_set_variant_override` | Per-variant exception for one entry/bullet: force include/exclude, rephrase text, or reorder. |
| `cv_add_letter_section` | Add a paragraph to a coverletter-kind variant. |
| `cv_resolve_variant` | Preview exactly what a variant renders, after rules + overrides — no PDF. |
| `cv_get_pdf` | Compile a variant to PDF; saves to disk; returns the path. |

### Typical session

```
cv_get_master(person_id)              # read everything once, with stable ids
cv_tag(entry, 42, ["frontend"])       # tag content naturally
cv_create_variant(person_id, "Frontend Resume", "resume")
cv_set_variant_rules(variant_id, include=["frontend","core"])
cv_resolve_variant(variant_id)        # verify the subset before rendering
cv_get_pdf(variant_id)                # → /tmp/.../variant-<id>.pdf, Read it
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `CV_EDITOR_URL` | `http://localhost:3001` | Base URL of the cv-editor backend. |
| `CV_MCP_PDF_DIR` | `$TMPDIR/cv-mcp-pdfs` | Where `cv_get_pdf` saves PDFs. |

## Install

```bash
cd packages/cv/mcp-server
npm install        # requires node >= 18
```

## Smoke test

```bash
# In one terminal — start cv-editor (e.g. PORT=3001 node ../editor/server.js)
# In another:
CV_EDITOR_URL=http://localhost:3001 node smoke-test.mjs
```

Runs the MCP handshake over stdio, lists tools, and drives a full
create → tag → variant → resolve → cleanup round-trip. Exits non-zero on failure.

## Register with Claude Code

```bash
claude mcp add cv-editor -s user \
  -e CV_EDITOR_URL=http://localhost:3001 \
  -- /path/to/node /full/path/to/packages/cv/mcp-server/server.mjs
```

Then restart Claude Code. Verify with `claude mcp list` — should show
`cv-editor: ... ✓ Connected`.
