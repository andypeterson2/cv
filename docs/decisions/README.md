# Decision artifacts — cv backend

Version-controlled decision records for this repo (`editor/` + `mcp-worker/`), so
the "why" doesn't live only in commit messages or one person's head.

- [`tech-debt-register.md`](./tech-debt-register.md) — prioritized tech-debt, scored
  and phased. Update it when debt is found or cleared.
- `adr/` _(planned)_ — Architecture Decision Records for the load-bearing calls:
  the remote MCP worker (stateless-signed OAuth, signed PDF links), the fail-closed
  auth model, and the LinkedIn export/drift design. Currently these live only in the
  assistant's memory (tech-debt item #5).

The **website** repo has its own, richer set at `website/docs/decisions/` (the
portal, the editor frontend, the API-contract refactor); this directory is the
backend-side complement.
