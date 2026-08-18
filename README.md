# LaTeX Resume Editor

A full-stack web application for managing resumes, CVs, and cover letters. Content is stored in a normalized SQLite database and compiled to PDF on demand via XeLaTeX using the [Awesome-CV](https://github.com/posquit0/Awesome-CV) document class.

The editor frontend runs entirely in the browser and connects to a local backend server — or loads a Jane Doe demo dataset when no backend is available, so it works as a live demo on [GitHub Pages](https://andypeterson.dev/projects/latex-resume-editor/app/).

## Features

- **Granular content management** — sections, entries, bullet points, and metrics as individual database records with full CRUD
- **Three document variants** — resume, CV, and cover letter, each with independent section ordering
- **Resume filtering** — toggle individual entries and bullet points on/off per variant without deleting them
- **Multi-person profiles** — switch between multiple people's data with a single click
- **Debounced autosave** — changes persist automatically via the REST API with 500ms debounce
- **Drag-and-drop reordering** — reorder sections and bullet points with SortableJS
- **Server-side LaTeX compilation** — XeLaTeX compiles documents to PDF with Roboto and Source Sans 3 fonts
- **JSON import/export** — bulk data portability across instances
- **Demo mode** — embedded Jane Doe dataset with static PDFs when no backend is connected

## Quick start

### Local (fastest dev loop)

The host needs **XeLaTeX plus the Source Sans 3 and Roboto fonts** installed. On macOS that's MacTeX (or BasicTeX + the packages below) and the two font families in `~/Library/Fonts`. On Debian/Ubuntu: `texlive-xetex texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-pictures` plus the fonts. (FontAwesome ships bundled in `templates/`.)

```bash
cd editor
npm install
npm run dev        # node --watch — hot-reloads on source changes — http://localhost:3001
# or: npm start    # no watch
```

`npm run dev` restarts the server when `server.js` / `lib/` / `routes/` change. Compiles shell out to the host `xelatex`, so no container is required locally. Only one process can own the port — stop the Docker container first if it's running.

### Docker — dev container

```bash
docker compose up -d --build    # http://localhost:3001  (Dockerfile target: dev)
```

The `dev` target bind-mounts your source and runs `node --watch`; production deps **and the embedding model are baked into the image**, so there is no per-boot `npm install` (boot is seconds). All LaTeX dependencies and fonts are pre-installed. After changing `editor/package.json` deps, re-seed the node_modules volume: `docker compose down -v && docker compose up -d --build`.

### Remote / production deploy

`docker-compose.deploy.yml` builds the **self-contained** `deploy` image (app code + deps + model COPYd in — no bind mounts) and runs it **behind a Caddy reverse proxy** that terminates TLS and enforces Basic-Auth. The app itself is **not** published to the host — only Caddy is reachable, so its lack of built-in auth can't be bypassed.

**Why a proxy and not an app token:** the API is unauthenticated full CRUD, and *both* compile routes (`GET /api/variants/:id/pdf`, `POST /api/variants/:id/compile`) shell out to a 30 s `xelatex` — a DoS lever — so every route must be gated. Basic-Auth + TLS need no app changes and the browser handles the login natively; a bearer token would still need a TLS proxy *and* a login flow in the frontend. CORS is **not** a security control.

```bash
# 1. Generate a bcrypt password hash (uses the caddy image; no local install):
docker run --rm caddy:2 caddy hash-password --plaintext 'your-secret'

# 2. Run (set the env; escape every `$` in the hash as `$$` for compose):
CV_DOMAIN=cv.example.com CV_USER=me CV_PASS_HASH='<bcrypt-hash>' \
  docker compose -f docker-compose.deploy.yml up -d --build
```

- **TLS** is automatic for a real `CV_DOMAIN` (Let's Encrypt; needs a DNS A-record + ports 80/443 reachable). Use `CV_DOMAIN=localhost` to test with Caddy's internal CA.
- **Clients send the credential.** Browser: native auth dialog. MCP server: set `CV_EDITOR_URL=https://cv.example.com` and `CV_EDITOR_AUTH="Basic $(printf 'me:your-secret' | base64)"`.
- Persists `cv.db` in the `cv_data` volume (`CV_DB_PATH=/data/cv.db`); certs persist in `caddy_data`. Keep volumes on local disk — SQLite WAL is unsafe on networked filesystems. Back up with `sqlite3 /data/cv.db ".backup …"` (never `cp` a live WAL DB).
- Set `CV_CORS_ORIGINS` to the real browser origin. Embedding runs fully offline (`CV_EMBED_OFFLINE=1`, model baked) — no network at runtime.

**Alternative (no open ports, per-person access):** put it behind a **Cloudflare Tunnel + Access** (or a **Tailscale** tailnet) instead of Caddy — the edge provides TLS and identity-based auth (grant people by email), the app stays unchanged, and the MCP server authenticates with a service token. Prefer this over a shared password when several distinct people need access.

**Live (this instance):** production runs on **Railway** — `editor/` built from the root `Dockerfile`, auto-deployed on push to `main`. The Railway origin isn't used directly: the `api.andypeterson.dev` gateway Worker and the MCP Worker are its only front doors, injecting the `X-Origin-Secret` the origin guard requires (see `lib/origin-guard.js`). `railway.json` `build.watchPatterns` scopes the deploy to the editor's build inputs (`editor/`, `shared/`, `assets/`, `Dockerfile`), so `mcp-worker/` pushes — which ship via `wrangler`, not Railway — don't rebuild the editor.

**Rotating `CV_ORIGIN_SECRET` (zero-downtime):** cv accepts a **comma-separated set** of origin secrets (`lib/origin-secret.js`), so you can rotate the shared front-door secret without a 403 window:

1. `openssl rand -hex 24` → the new value.
2. Set cv (Railway) `CV_ORIGIN_SECRET = "<old>,<new>"` and redeploy — cv now accepts **both**.
3. Flip each sender (they each present one value) to `<new>`: in `andypeterson-gateway/worker` and `cv/mcp-worker`, `wrangler secret put CV_ORIGIN_SECRET`.
4. Set cv (Railway) `CV_ORIGIN_SECRET = "<new>"` and redeploy — drops `<old>`.

A sender left out of sync surfaces as `GET api.andypeterson.dev/cv/api/persons` returning 403 instead of 200 (the `andypeterson-monitor` watchdog can probe that path to catch it).

## Architecture

```
editor/
├── server.js               Express API server
├── lib/
│   ├── db.js               SQLite abstraction (better-sqlite3, prepared statements)
│   ├── schema.js           JSON Schema validation (AJV) for all write endpoints
│   ├── serializer.js       JSON → LaTeX conversion with proper escaping
│   ├── parser.js           LaTeX → JSON parsing (brace extraction, command detection)
│   ├── generator.js        Orchestrates DB → .tex file generation
│   └── braceExtractor.js   LaTeX brace-delimited argument parser
├── public/
│   ├── app.js              Alpine.js frontend (modal system, autosave, demo mode)
│   └── index.html          Standalone editor UI
├── migrations/             Database schema migrations
└── tests/
    ├── unit/               7 test files — serializer, parser, schema, db, generator
    ├── integration/        2 test files — full API lifecycle, multi-step workflows
    └── dom/                7 test files — UI interactions via happy-dom
```

### Data model

```
Person ──┬── Settings (key-value pairs: personal info, style, coverletter header)
         ├── Section ──── Entry ──── Item (bullet point)
         ├── Metric (custom LaTeX variables, grouped)
         └── Document (variant-specific section ordering + enable/disable)
```

### Serialization pipeline

1. **Database** — normalized rows in SQLite via `db.js`
2. **Generator** — reads DB, calls serializers per section type
3. **Serializer** — converts JSON entries to LaTeX (`\cventry`, `\cvskill`, `\cvhonor`, etc.)
4. **XeLaTeX** — compiles `.tex` to PDF with Awesome-CV class

## API reference

All endpoints return JSON. Base path: `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET/PATCH` | `/api/settings` | Personal info, style, and coverletter header |
| `GET/POST` | `/api/sections` | List or create sections |
| `GET/PUT/DELETE` | `/api/sections/:id` | Read, update, or delete a section |
| `POST` | `/api/sections/:id/entries` | Add an entry to a section |
| `PATCH` | `/api/sections/:id/entries/order` | Reorder entries |
| `PUT/DELETE` | `/api/entries/:id` | Update or delete an entry |
| `POST` | `/api/entries/:id/items` | Add a bullet-point item |
| `PATCH` | `/api/entries/:id/items/order` | Reorder items |
| `PUT/DELETE` | `/api/items/:id` | Update or delete an item |
| `GET/POST/PUT/DELETE` | `/api/metrics[/:id]` | Manage custom LaTeX variables |
| `GET/PUT` | `/api/documents/:variant` | Section ordering per document variant |
| `GET/POST/PUT/DELETE` | `/api/coverletter/sections[/:id]` | Cover letter body sections |
| `PATCH` | `/api/coverletter/sections/order` | Reorder cover letter sections |
| `GET/POST/PUT/DELETE` | `/api/persons[/:id]` | Manage person profiles |
| `POST` | `/api/persons/:id/switch` | Switch active person |
| `POST` | `/api/import` | Bulk import JSON data |
| `GET` | `/api/export` | Export all data as JSON |
| `POST` | `/api/compile/:variant` | Compile to PDF (cv, resume, coverletter) |
| `GET` | `/api/pdf/:variant` | Download compiled PDF |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `CV_DB_PATH` | `../cv.db` | SQLite database path (set to `/data/cv.db` for the deploy volume) |
| `CV_CORS_ORIGINS` | *(localhost ports)* | Comma-separated allowed origins |
| `CV_EMBED_OFFLINE` | *(unset)* | Set to `1` to forbid any runtime model download (deploy/dev images set this; the model is baked in) |

## Testing

525 tests across three layers:

```bash
npm test                 # all tests (vitest)
npm run test:unit        # unit tests — serializer, parser, schema, db, generator
npm run test:integration # integration tests — full API lifecycle, workflows
npm run test:dom         # DOM tests — UI interactions via happy-dom
```

## Tech stack

| Layer | Technology |
|---|---|
| Server | Express, Node.js |
| Database | better-sqlite3 (SQLite) |
| Validation | AJV (JSON Schema) |
| Frontend | Alpine.js, SortableJS |
| PDF | XeLaTeX, Awesome-CV |
| Testing | Vitest, happy-dom, @testing-library/dom |
| Infrastructure | Docker |

## Documents

Pre-compiled PDFs:

- [CV (pdf)](cv.pdf)
- [Resume (pdf)](resume.pdf)
- [Cover Letter (pdf)](coverletter.pdf)

Required fonts: [Roboto](https://fonts.google.com/specimen/Roboto) and [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3)
