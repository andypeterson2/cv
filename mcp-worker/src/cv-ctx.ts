import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-call user context — WHO is driving cv for the current MCP tool call (or signed
 * PDF fetch). Carried across awaits so the cv HTTP helper (`api()` in tools.ts) can
 * inject a verified `X-User-Id` per caller WITHOUT threading a userId through all 57
 * tool handlers. Set once at each dispatch boundary:
 *   - mcp.ts   — the CallTool handler, from `this.props.cvUserId`
 *   - index.ts — servePdf, from the signed link's payload
 * and read in tools.ts `api()`. Runtime comes from the `nodejs_compat` flag; the type
 * from a minimal shim (see async-hooks-shim.d.ts) so we skip @types/node.
 */
export const cvCtx = new AsyncLocalStorage<{ cvUserId: number }>();
