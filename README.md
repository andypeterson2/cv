# LaTeX Resume Editor

A web app for managing resumes, CVs and cover letters. Content lives as normalized rows in SQLite and compiles to PDF on demand with XeLaTeX. Sections, entries and bullets are separate records, so one set of content produces three documents: each variant keeps its own section order and can switch individual entries and bullets off without deleting them.

This repository holds two services. `editor/` is the REST API and the compile pipeline; it serves no HTML, so the editor UI lives in the portal that consumes it. `mcp-worker/` is a remote MCP server on Cloudflare Workers that drives the same API over OAuth. The live page at [andypeterson.dev](https://andypeterson.dev/projects/latex-resume-editor/app/) shows a demo profile.

## Tag suggestions

Tags decide which content each variant includes. Suggestions rank the tags that already exist for a bullet, using a local all-MiniLM-L6-v2 int8 embedding blended 60/40 with votes from the profile's eight most similar tagged bullets. They never invent a tag, and nothing is applied without a click.

The blend weight, the eight neighbours and the starter-vocabulary cutoff were chosen by leave-one-out over 68 private résumé bullets and then scored on those same 68 rows, which makes the figure a fit rather than an estimate of how the suggester does on bullets it has not seen: hit@3 59/68 (86.8%) to 62/68 (91.2%), hit@1 41/68 (60.3%) to 46/68 (67.6%) — 3 and 5 bullets.

`editor/scripts/eval-tag-suggest.cjs` re-measures the same comparison on a disjoint split instead. A seeded stratified half selects the parameters; the other half is scored once, and nothing in the selection step reads it. It prints hit@1 and hit@3 as item counts over the n of each half, for the embedding ranker alone and for the blend, because on a half of 34 one bullet moves a rate by 2.9 points. No held-out figure is quoted here yet, because the tag labels that evaluation needs are absent from every database still on hand — the live profile's 175 bullets carry none — so the rates could not be recomputed under the split. The bullet text is private in any case, so nobody without that corpus can regenerate them; the seed and the split rule are fixed in the script, so the same corpus always yields the same two halves.

While a profile has fewer than 30 tags of their own, suggestions also draw on a starter vocabulary (`editor/lib/seed-tags.json`) of 42 broad résumé categories plus ESCO technology, transversal and research skills. A starter tag joins the profile's catalog, with its description, the first time it is used.

## Running it locally

The host needs XeLaTeX and the Source Sans 3 and Roboto fonts. On macOS that is MacTeX (or BasicTeX plus the packages below) and the two families in `~/Library/Fonts`. On Debian or Ubuntu: `texlive-xetex texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-pictures`, plus the fonts. FontAwesome ships inside each layout bundle.

```bash
cd editor
npm install
npm run dev        # node --watch on http://localhost:3001
# or: npm start    # no watch
```

Compiles shell out to the host `xelatex`, so no container is needed. Only one process can hold the port, so stop the Docker container first if it is running.

`better-sqlite3` is a native module, so it is built against whichever Node built it. Switching Node versions between installs makes every database test fail with `NODE_MODULE_VERSION`; `npm rebuild better-sqlite3` fixes it. CI runs Node 22.

```bash
docker compose up -d --build    # dev image, http://localhost:3001
```

The dev image bind-mounts the source and runs `node --watch`; deps and the embedding model are baked in. After changing `editor/package.json`, re-seed the volume with `docker compose down -v && docker compose up -d --build`.

## Deploying it

`docker-compose.deploy.yml` builds a self-contained image and runs it behind a Caddy reverse proxy that terminates TLS and enforces Basic-Auth. Only Caddy is reachable from outside, and both compile routes shell out to a 30-second `xelatex`, so every route has to be covered.

This composition sets none of the auth variables below, so Caddy's password is the only thing in front of the API. That is the intended shape for a single-operator box. For a multi-account deployment, set `CV_EDITOR_TOKEN` and `CV_ORIGIN_SECRET` (with `CV_ORIGIN_SECRET_ENFORCE=true`) as well, and set `CV_TRUST_CF_IP=true` only when Cloudflare is the hop in front — it is what makes the per-IP rate limits trustworthy.

```bash
# bcrypt hash for the password (uses the caddy image; nothing to install)
docker run --rm caddy:2 caddy hash-password --plaintext 'your-secret'

# escape every `$` in the hash as `$$` for compose
CV_DOMAIN=cv.example.com CV_USER=me CV_PASS_HASH='<bcrypt-hash>' \
  docker compose -f docker-compose.deploy.yml up -d --build
```

- TLS is automatic for a real `CV_DOMAIN` (Let's Encrypt, so it needs a DNS A-record and ports 80 and 443). `CV_DOMAIN=localhost` tests against Caddy's internal CA.
- A browser sends the Basic-Auth credential through its own dialog. The MCP Worker reaches the API by `CV_EDITOR_URL` and authenticates with `CV_ORIGIN_SECRET`; see `mcp-worker/README.md`.
- `cv.db` persists in the `cv_data` volume (`CV_DB_PATH=/data/cv.db`) and certs in `caddy_data`. Keep both on local disk — SQLite WAL is unsafe on networked filesystems. Back up with `sqlite3 /data/cv.db ".backup …"`, never by copying a live WAL database.
- Set `CV_CORS_ORIGINS` to the real browser origin. Embedding runs offline (`CV_EMBED_OFFLINE=1`), so nothing reaches the network at runtime.

## Data model

```
User ───── Profile ──┬── Personal info (per-profile key-value settings)
                    ├── Section ──── Entry ──── Item (bullet point)
                    └── Variant (tag rules + section order + per-entry overrides)
```

Every profile belongs to an account, and an account sees only its own. Style, spacing and fonts are per-account; a document renders with the style of the account that owns its profile, so a shared or public profile looks the same to every reader. Profiles owned by the built-in `@system` account (the Jane Doe demo) are the public ones: anyone can read them without signing in, and only that account can change them.

A document is produced by resolving a variant into plain data, rendering it through the chosen layout's templates, and compiling the result with XeLaTeX. Layouts are swappable bundles: two ship with the image, and an account can upload its own, which is installed only after it passes verification. An author can publish an upload: it is copied as the next numbered version, verified again, and listed for every account once the site owner approves it. Anyone may pin a public version to a variant or as their default and keeps it until they choose a newer one; unpublishing hides a version from the list without breaking anyone already using it.

## API reference

All endpoints return JSON under `/api`, and `GET /api` lists every one of them — 84 at the time of writing — so the authoritative reference is the running service:

```bash
curl -s localhost:3001/api | jq '.endpoints[] | "\(.method) \(.path)"'
```

The shape, by prefix:

| Prefix | What lives there |
|---|---|
| `/api/health`, `/api/catalog` | Liveness, and the static catalogs the UI renders pickers from |
| `/api/settings` | Style, spacing and fonts for the calling account |
| `/api/profiles`, `/api/profiles/:id/…` | Profiles, and everything scoped to one: personal info, sections, variants, versions, tags, import/export, LinkedIn sync |
| `/api/sections/:id`, `/api/entries/:id`, `/api/items/:id` | The id-addressed content tree, plus tags |
| `/api/variants/:id/…` | Tag rules, section order, per-entry overrides, cover-letter paragraphs, `/resolve`, and the compile routes |
| `/api/layouts` | List, check, upload (a file or an https URL), download, verify, publish, unpublish, delete, the owner's review queue, and the account's default |

Errors share one body: `{"error": {"code": "...", "message": "...", "details": ...}}`, with the HTTP status carrying the class. The compile routes add `success` and the xelatex `log` beside it.

## Environment variables

None are required; the defaults run an open, single-account instance on localhost.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `CV_DB_PATH` | `<repo>/cv.db` | SQLite database path (set to `/data/cv.db` for the deploy volume) |
| `CV_LAYOUTS_DIR` | `<repo>/layouts-store` | Where uploaded layout bundles are written |
| `CV_EMBED_OFFLINE` | *(unset)* | Set to `1` to forbid any runtime model download (the images set this; the model is baked in) |

Access. With none of these set the API is open, which is what local dev and the tests rely on.

| Variable | Default | Description |
|---|---|---|
| `CV_EDITOR_TOKEN` | *(unset)* | Shared owner token. Unset disables the check entirely |
| `CV_ORIGIN_SECRET` | *(unset)* | Front-door secret. Accepts a comma-separated set so it can be rotated one sender at a time |
| `CV_ORIGIN_SECRET_ENFORCE` | `false` | `true` rejects a request without a valid secret; until then a miss is logged and allowed |
| `OWNER_EMAIL`, `OWNER_NAME` | *(unset)* | The Google address that adopts the owner account on first sign-in |
| `CV_PROD_ORIGIN` | `https://andypeterson.dev` | Browser origin allowed by CORS |
| `CV_CORS_ORIGINS` | *(none)* | Extra comma-separated exact origins |

Cost and abuse. Each compile spawns a XeLaTeX process, so these bound it.

| Variable | Default | Description |
|---|---|---|
| `CV_TRUST_CF_IP` | `false` | `true` keys rate limits on `CF-Connecting-IP`. Set it only behind Cloudflare, which overwrites that header — anywhere else a client can pick its own value |
| `CV_COMPILE_RATE_MAX` | `10` | Compiles per minute per client |
| `CV_COMPILE_DAILY_LIMIT` | `100` | Compiles per account per UTC day (the owner is exempt) |
| `CV_COMPILE_CONCURRENCY` | `2` | XeLaTeX processes allowed at once |
| `CV_COMPILE_PER_USER` | `1` | Compiles one account may run at once; up to 3 more wait, beyond that the compile returns 429 |
| `CV_COMPILE_TIMEOUT_MS` | `30000` | Per-compile timeout |
| `CV_LAYOUT_MAX_COMPILE_MS` | `10000` | Slowest fixture compile a layout version may have and still be approved for sharing |
| `CV_UPLOAD_RATE_MAX` | `5` | Layout uploads per minute per client |

## Testing

```bash
npm test                 # all tests (vitest)
npm run test:unit        # unit tests — serializer, schema, db, generator, migrations
npm run test:integration # integration tests — full API lifecycle, ownership, workflows
npm run test:coverage    # the same suite with the coverage floors CI enforces
```

`tests/contract/` holds live-HTTP contract tests (pytest) that check the health, discovery and error shapes against JSON Schemas. Point `CV_EDITOR_URL` at a running editor; they skip if it is unreachable. `mcp-worker/` has its own suite, run from that directory.

## Documents

Résumé content lives only in the deployed database; this repository holds the editor, not anyone's documents. PDFs are compiled on demand by the running service, through the compile routes above or the MCP Worker's `cv_get_pdf`. Compilation needs [Roboto](https://fonts.google.com/specimen/Roboto) and [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3).

## Third-party data

The starter tag vocabulary contains ESCO classification data (v1.1.0), © European Union, https://esco.ec.europa.eu, reused under Commission Decision 2011/833/EU. ESCO labels are shortened to tags. Regenerate the file from the ESCO CSV download with `python scripts/build_seed_tags.py --esco-dir <dir>`.
