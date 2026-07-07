# cv-editor

The LaTeX résumé / CV / cover-letter web editor: an Express app over a
`better-sqlite3` database that serves the id-addressable REST API the portal's
Svelte editor consumes, and compiles variants to PDF via `xelatex`.

## Development

Use the pinned Node version (`.nvmrc`). Two things matter:

- The test runner (Vitest) needs a modern Node — Node 14 fails to load it.
- `better-sqlite3` is a **native** module, compiled for the exact Node version
  that installed it. If the binding and the running Node disagree, everything
  that opens a database throws at startup.

```sh
nvm use            # Node 20 — matches the Docker image
npm ci             # builds the native better-sqlite3 binding for this Node
npm test           # 300+ unit + integration tests
```

If you switch Node versions and see
`The module '.../better_sqlite3.node' was compiled against a different Node.js version`:

```sh
npm rebuild better-sqlite3
```

## Deploy

Railway builds from the repo-root `Dockerfile` (`node:20-slim`) and auto-deploys
on push to `main` **after** the repo's GitHub Actions CI passes (a push alone
does not deploy until CI is green).
