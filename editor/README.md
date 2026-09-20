# cv-editor

The LaTeX résumé / CV / cover-letter web editor: an Express app over a
`better-sqlite3` database that serves the id-addressable REST API the portal's
Svelte editor consumes, and compiles variants to PDF via `xelatex`.

## Development

Use the pinned Node version (`.nvmrc`). Two things matter:

- `package.json` requires Node 22 or newer, which is what CI and the image run.
- `better-sqlite3` is a **native** module, compiled for the exact Node version
  that installed it. If the binding and the running Node disagree, everything
  that opens a database throws at startup.

```sh
nvm use            # Node 22 — matches the Docker image
npm ci             # builds the native better-sqlite3 binding for this Node
npm test           # the unit + integration suite
```

If you switch Node versions and see
`The module '.../better_sqlite3.node' was compiled against a different Node.js version`:

```sh
npm rebuild better-sqlite3
```

## Deploy

Railway builds from the repo-root `Dockerfile` (`node:22-slim`) and auto-deploys
on push to `main` **after** the repo's GitHub Actions CI passes (a push alone
does not deploy until CI is green).

Two things follow from that, and both have bitten:

- A commit that touches nothing in `railway.json`'s `watchPatterns` (`editor/**`,
  `shared/**`, `assets/**`, `Dockerfile`, `.dockerignore`, `railway.json`) is skipped,
  however green it is. Releasing a change that lives outside those paths needs a
  redeploy from the Railway dashboard.
- Any red job on `main` holds the release, including one that has nothing to do with
  the editor. Deploys therefore report from their own workflows, so a service that
  cannot ship never decides whether another one does.

The first boot after a deploy applies pending migrations before the server listens,
and exits non-zero if one fails — a bad migration is a failed deploy with the previous
container still serving, not a half-migrated database.
