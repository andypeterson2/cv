# Decision artifacts — cv backend

Version-controlled decision records for this repo (`editor/` + `mcp-worker/`), so
the "why" doesn't live only in commit messages or one person's head.

- [`tech-debt-register.md`](./tech-debt-register.md) — prioritized tech-debt, scored
  and phased. Update it when debt is found or cleared.
- [`adr/`](./adr/) — Architecture Decision Records for the load-bearing calls:

  | ADR | Decision |
  |---|---|
  | [008](./adr/ADR-008-one-remote-mcp-server.md) | One remote MCP server, with stateless-signed OAuth |
  | [009](./adr/ADR-009-fail-closed-auth.md) | Auth fails closed — resolve the owner, and give the origin a front door |
  | [010](./adr/ADR-010-linkedin-downstream-consumer.md) | LinkedIn is a downstream consumer; the fingerprint is the product |

## Numbering

**The ADR sequence is system-wide and shared with the website repo** — it is not
per-repo. `website/docs/decisions/architecture-decision-log.html` holds ADR-001…007
(demo-as-default, the guided tour, undo, per-profile undo scopes, the interface tells
the truth, the versioned CV store, multi-tenant review). Several of those already span
both sides — ADR-006's versioned store is frontend *and* this backend's migrations
013/014.

So this directory **continues at 008**. When adding one, take the next free number
across **both** repos so "ADR-00X" is never ambiguous.

The website's log is a rendered HTML artifact (it's a static site and the log is
readable/shareable); here they're markdown, because a backend repo wants records that
diff in review and need no build step.
