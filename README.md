# cv

My CV, typed up in LaTeX for my own editing purposes. I'm using Awesome-CV as a base, which you can find maintained [here](https://github.com/posquit0/Awesome-CV).

Necessary fonts: [Roboto](https://fonts.google.com/specimen/Roboto) and [Source Sans Pro/3](https://fonts.google.com/specimen/Source+Sans+3)

## Documents

- [CV (pdf)](cv.pdf)
- [Resume (pdf)](resume.pdf)
- [Cover Letter (pdf)](coverletter.pdf)

## Editor

The `editor/` directory contains a web-based editor for managing CV/resume/cover letter content. It uses **Express** for the API, **better-sqlite3** for persistence, and compiles documents to PDF via **XeLaTeX**.

### Setup (local)

```bash
cd editor
npm install
npm start          # starts on http://localhost:3000
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `CV_DB_PATH` | `../cv.db` | SQLite database path |
| `CV_CORS_ORIGINS` | *(several localhost ports)* | Comma-separated allowed origins |

LaTeX compilation requires `texlive-xetex`, `texlive-fonts-extra`, and `texlive-fonts-recommended` installed on the host.

### Docker

```bash
docker compose up --build
```

This builds a container with all LaTeX dependencies and fonts pre-installed. The server is exposed on port `3001` by default (configurable via the `PORT` env var). Source files are bind-mounted so edits are reflected immediately.

### API Endpoints

All endpoints are JSON. Base path: `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET/PATCH` | `/api/settings` | Personal info and coverletter header |
| `GET/POST` | `/api/sections` | List or create sections |
| `GET/PUT/DELETE` | `/api/sections/:id` | Read, update, or delete a section |
| `POST` | `/api/sections/:id/entries` | Add an entry to a section |
| `PATCH` | `/api/sections/:id/entries/order` | Reorder entries |
| `PUT/DELETE` | `/api/entries/:id` | Update or delete an entry |
| `POST` | `/api/entries/:id/items` | Add a bullet-point item |
| `PATCH` | `/api/entries/:id/items/order` | Reorder items |
| `PUT/DELETE` | `/api/items/:id` | Update or delete an item |
| `GET/POST/PUT/DELETE` | `/api/metrics[/:id]` | Manage metrics |
| `GET` | `/api/documents` | List document variants |
| `GET/PUT` | `/api/documents/:variant` | Get or set section ordering per variant |
| `GET/POST/PUT/DELETE` | `/api/coverletter/sections[/:id]` | Cover letter sections |
| `PATCH` | `/api/coverletter/sections/order` | Reorder cover letter sections |
| `GET/POST/PUT/DELETE` | `/api/persons[/:id]` | Manage person profiles |
| `POST` | `/api/persons/:id/switch` | Switch active person |
| `POST` | `/api/import` | Bulk import data |
| `GET` | `/api/export` | Export all data |
| `POST` | `/api/compile/:variant` | Compile a variant to PDF (cv, resume, coverletter) |
| `GET` | `/api/pdf/:variant` | Download compiled PDF |

### Tests

```bash
npm test            # jest (unit + integration)
npm run test:dom    # vitest (DOM tests)
npm run test:all    # both
```
