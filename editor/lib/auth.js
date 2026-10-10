/**
 * Optional shared-token auth (defense in depth; the public app is fronted by the
 * gateway but the backend is ALSO directly reachable, so this is the real gate).
 *
 * No-op unless CV_EDITOR_TOKEN is set (local dev + tests stay open). When set,
 * `Authorization: Bearer <token>` is required for:
 *   - all writes (POST/PUT/PATCH/DELETE),
 *   - the compile GET (…/pdf — a CPU/DoS lever, gated regardless of profile),
 *   - reads that expose a NON-PUBLIC profile's data. A profile owns not just
 *     `/profiles/<id>/…` but the id-addressed resources hanging off it —
 *     `/variants/<id>` (its /resolve returns the whole CV), `/sections/<id>`,
 *     `/entries/<id>`, `/items/<id>` — so the owning profile is resolved for all of
 *     them (getDb().ownerProfileId) and gated unless that profile is public
 *     (getDb().isPublicProfile: owned by the '@system' demo account). Non-profile globals (the profile LIST, /settings, /layouts,
 *     /catalog, /health) stay open for the demo; ANYTHING ELSE is denied by default,
 *     so a new profile-data route can't silently leak while nobody's looking.
 *
 * NOTE: mounted at `app.use('/api', …)`, so `req.path` here is /api-stripped
 * (e.g. `/variants/10/resolve`); we tolerate a leading `/api` anyway for tests.
 */
const { parseOriginSecrets, matchesOriginSecret } = require('./origin-secret');

function tokenAuth(token, { getDb = null, originSecret = null } = {}) {
  // Accepted front-door secrets (a SET, for zero-downtime rotation).
  const originSecrets = parseOriginSecrets(originSecret);

  // The owning profile of an id-addressed resource, or null (unknown / no db).
  const owner = (kind, id) => {
    if (!getDb) return null;
    try {
      return getDb().ownerProfileId(kind, Number(id));
    } catch {
      return null;
    }
  };

  // Whether a profile is the public demo; unknown (or no db) counts as private.
  const isPublic = (profileId) => {
    if (!getDb || profileId == null) return false;
    try {
      return getDb().isPublicProfile(profileId);
    } catch {
      return false;
    }
  };

  // Classify a GET path: {profile:<id|null>} (gate unless public), {global:true}
  // (open), or null (unrecognized → default-deny).
  const classify = (raw) => {
    const path = raw.replace(/^\/api(?=\/|$)/, ''); // tolerate the /api-prefixed form
    let m;
    if ((m = path.match(/^\/profiles\/(\d+)(?:\/|$)/))) return { profile: Number(m[1]) };
    if ((m = path.match(/^\/variants\/(\d+)(?:\/|$)/))) return { profile: owner('variant', m[1]) };
    if ((m = path.match(/^\/sections\/(\d+)(?:\/|$)/))) return { profile: owner('section', m[1]) };
    if ((m = path.match(/^\/entries\/(\d+)(?:\/|$)/))) return { profile: owner('entry', m[1]) };
    if ((m = path.match(/^\/items\/(\d+)(?:\/|$)/))) return { profile: owner('item', m[1]) };
    if (/^\/(profiles|settings|layouts|catalog|health)(?:\/|$)/.test(path)) return { global: true };
    return null; // unknown → deny
  };

  const headerOf = (req, name) =>
    (req.get ? req.get(name) : req.headers && req.headers[name.toLowerCase()]) || '';

  // eslint-disable-next-line sonarjs/cognitive-complexity -- grandfathered at 18; split when next touched
  return function (req, res, next) {
    if (!token) return next(); // disabled → open (local dev / tests)

    // A front-door-authenticated USER: the gateway verified
    // their Google session and injected X-User-Id behind the shared front-door secret.
    // Let it through — the per-user profile scoping downstream is what isolates them;
    // a direct caller can't forge X-Origin-Secret, so it can't set a trusted X-User-Id.
    if (headerOf(req, 'X-User-Id')) {
      if (
        originSecrets.length === 0 ||
        matchesOriginSecret(headerOf(req, 'X-Origin-Secret'), originSecrets)
      )
        return next();
    }

    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isCompileGet = req.method === 'GET' && /\/pdf$/.test(req.path);

    // A read that exposes a non-public profile's data (or an unrecognized read) is gated.
    let isGatedRead = false;
    if ((req.method === 'GET' || req.method === 'HEAD') && !isCompileGet) {
      const c = classify(req.path);
      if (!c)
        isGatedRead = true; // unrecognized route → default-deny
      else if (c.global)
        isGatedRead = false; // safe global → open
      else isGatedRead = !isPublic(c.profile); // profile data → gate unless public (null owner → gated)
    }

    if (!isWrite && !isCompileGet && !isGatedRead) return next();

    const header =
      (req.get ? req.get('authorization') : req.headers && req.headers.authorization) || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (provided && provided === token) return next();

    return res.status(401).json({ error: { code: 'unauthorized', message: 'Unauthorized' } });
  };
}

module.exports = { tokenAuth };
