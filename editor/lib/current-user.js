/**
 * Resolves the user behind a request, in one place, so every route can read
 * `req.userId` and the person data layer can scope by it:
 *   - a request bearing the owner token is the owner ('@owner');
 *   - a request carrying a gateway-verified X-User-Id is that user;
 *   - anything else is the demo account ('@system'), which owns only the public
 *     person(s);
 *   - with no token configured (local dev and tests) the request acts as the owner.
 */
const { parseOriginSecrets, matchesOriginSecret } = require('./origin-secret');

function readHeader(req, name) {
  return (req.get ? req.get(name) : req.headers && req.headers[name.toLowerCase()]) || '';
}

function attachUser(
  getDb,
  { token = process.env.CV_EDITOR_TOKEN, originSecret = process.env.CV_ORIGIN_SECRET } = {},
) {
  // Accepted front-door secrets (a SET, for zero-downtime rotation).
  const originSecrets = parseOriginSecrets(originSecret);
  return function (req, _res, next) {
    const db = getDb();

    // The gateway names the signed-in user via X-User-Id. Trust it only with a matching
    // X-Origin-Secret so direct callers can't spoof a user; no secret set ⇒ trusted.
    const headerUser = readHeader(req, 'X-User-Id');
    if (headerUser) {
      const fromFrontDoor =
        originSecrets.length === 0 ||
        matchesOriginSecret(readHeader(req, 'X-Origin-Secret'), originSecrets);
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
