import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-call user context — WHO is driving cv for the current MCP tool call (or signed
 * PDF fetch). Carried across awaits so the cv HTTP helper `api()` can inject a
 * verified `X-User-Id` per caller WITHOUT threading a userId through every tool
 * handler. Set once at each dispatch boundary:
 *   - the CallTool handler, from `this.props.cvUserId`
 *   - servePdf, from the signed link's payload
 * and read in `api()`. Runtime comes from the `nodejs_compat` flag; the type from a
 * minimal ambient shim so we skip @types/node.
 */
export const cvCtx = new AsyncLocalStorage<{ cvUserId: number }>();
