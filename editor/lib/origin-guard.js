/**
 * Front-door guard — reject anything that did not arrive through one of our own
 * front doors.
 *
 * The Railway origin is publicly reachable, so without this the shared
 * CV_EDITOR_TOKEN is the only thing standing in front of it: a leaked token alone
 * would be enough, and direct-origin probing still reaches every public endpoint.
 * Both front doors inject `X-Origin-Secret` and nothing else does:
 *   - the api.andypeterson.dev gateway worker (cv upstream only), and
 *   - the mcp.andypeterson.dev MCP worker (its api() helper, which the signed
 *     /pdf/<token> links also route through).
 * This is defense in depth *on top of* tokenAuth, not a replacement for it.
 *
 * Exempt:
 *   - `/health` and `/api/health` — the container HEALTHCHECK hits these from
 *     127.0.0.1 with no header, and they carry no person data. Gating them would
 *     fail the healthcheck and flap the deploy.
 *   - `OPTIONS` — CORS preflight carries no data and must stay permissive.
 *
 * No-op unless CV_ORIGIN_SECRET is set, so local dev + tests stay open. The rollout
 * is two-stage on purpose: while `enforce` is false a missing/wrong secret is LOGGED
 * but allowed, so the front doors can be deployed to inject the header before the
 * gate actually closes (otherwise enforcing first = instant outage). Flip
 * CV_ORIGIN_SECRET_ENFORCE=true to close it; flip it back to roll back.
 */
function originGuard(secret, { enforce = false, log = console.warn } = {}) {
  return function (req, res, next) {
    if (!secret) return next(); // disabled → open (local dev / tests)
    if (req.method === 'OPTIONS') return next(); // CORS preflight
    if (/^\/(api\/)?health\/?$/.test(req.path)) return next(); // container/platform healthcheck

    const provided = req.get
      ? req.get('x-origin-secret')
      : req.headers && req.headers['x-origin-secret'];
    if (provided === secret) return next();

    if (!enforce) {
      log(
        `[origin-guard] soft: ${req.method} ${req.path} arrived without a valid X-Origin-Secret (would be 403 once enforcing)`,
      );
      return next();
    }
    return res.status(403).json({ error: { code: 'forbidden', message: 'Forbidden' } });
  };
}

module.exports = { originGuard };
