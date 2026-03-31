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

### Local

```bash
cd editor
npm install
npm start          # http://localhost:3000
```

LaTeX compilation requires `texlive-xetex`, `texlive-fonts-extra`, and `texlive-fonts-recommended` on the host.

### Docker (recommended)

```bash
docker compose up --build    # http://localhost:3001
```

All LaTeX dependencies and fonts are pre-installed in the container.

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
| `CV_DB_PATH` | `../cv.db` | SQLite database path |
| `CV_CORS_ORIGINS` | *(localhost ports)* | Comma-separated allowed origins |

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
