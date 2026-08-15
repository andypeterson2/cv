/**
 * The request → user seam (multi-tenancy phase 1).
 *
 * Every request that reaches a route carries a `req.userId`, and the person data
 * layer scopes by it. This keeps the resolution in ONE place so phase 2 can swap
 * how the user is identified without touching any route.
 *
 * Phase 1 is behaviour-preserving — there is no real per-visitor auth yet, so:
 *   - a request bearing the owner token IS the owner ('@owner');
 *   - anything else is the demo/system account ('@system'), which owns only the
 *     public person(s) — exactly what the token gate already exposed;
 *   - with no token configured (local dev / tests) we act as the owner.
 *
 * Phase 2 replaces the body below with "read the gateway-verified X-User-Id",
 * falling back to '@system' for logged-out visitors. Nothing else changes.
 */
function readHeader(req, name) {
  return (req.get ? req.get(name) : req.headers && req.headers[name.toLowerCase()]) || '';
}

function attachUser(
  getDb,
  { token = process.env.CV_EDITOR_TOKEN, originSecret = process.env.CV_ORIGIN_SECRET } = {},
) {
  return function (req, _res, next) {
    const db = getDb();

    // Phase 2: the gateway verifies the visitor's Google session and tells us WHICH
    // user via X-User-Id. Trust it only from the front door — a matching
    // X-Origin-Secret (the same proof cv's origin-guard checks) — so a direct caller
    // can't spoof a user. Unset secret (local dev / tests) ⇒ the header is trusted.
    const headerUser = readHeader(req, 'X-User-Id');
    if (headerUser) {
      const fromFrontDoor = !originSecret || readHeader(req, 'X-Origin-Secret') === originSecret;
      const uid = parseInt(headerUser, 10);
      if (fromFrontDoor && Number.isFinite(uid)) {
        req.userId = uid;
        return next();
      }
    }

    // Legacy owner path (until the Access→sessions switchover) + local dev / tests.
    let userId;
    if (!token) {
      userId = db.ownerUserId(); // the single operator is the owner
    } else {
      const header = readHeader(req, 'Authorization');
      const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
      userId = provided && provided === token ? db.ownerUserId() : db.systemUserId();
    }

    req.userId = userId;
    next();
  };
}

module.exports = { attachUser };
