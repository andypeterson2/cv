# Dependency decisions

The record that used to live only in commit messages — so the next audit
doesn't re-derive it.

## mcp-worker: the workers-toolchain unlock (closed 2026-08-31)

The chain, as it stood from July: `wrangler >= 4.114` peer-requires
`@cloudflare/workers-types v5`, which the runtime `agents` SDK's
`partyserver` pin rejected at 0.5.8. Four high advisories in wrangler's
bundled miniflare (sharp libvips, undici) were accepted as dev-only
residuals while blocked (recorded in commit `df10f22`).

Resolution: `partyserver 0.5.10` began accepting workers-types v5 within
`agents ^0.17`'s own range — no agents major bump needed. `workers-types
^5` + `wrangler ^4.128` landed directly; `npm audit` is clean; tests and a
dry-run deploy pass. Dependabot PR #27 (workers-types v5) was superseded
by that commit.

## Open, deliberately

- `agents ^0.17` (runtime): 0.22 exists but changes peer requirements
  (ai ^6/^7, zod ^4) and is a behavior-bearing runtime SDK — bump it for a
  feature reason, not a version number.
- `typescript ^6` (PR #28 proposes 7): major; take it with a typecheck
  sweep, not as a drive-by.

## Conventions

- `mcp-worker/.npmrc` (`install-links=true`) is committed and allowlisted in
  .gitignore — lockfiles are only valid when generated under it (the
  gitignore-swallowed-npmrc CI trap, fixed in `b8d2b70`).
- Tests run with `remoteBindings: false` so they can never touch production
  KV (they once did).
