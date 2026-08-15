/**
 * Optional shared-token auth (defense in depth; the public app is fronted by the
 * gateway but the backend is ALSO directly reachable, so this is the real gate).
 *
 * No-op unless CV_EDITOR_TOKEN is set (local dev + tests stay open). When set,
 * `Authorization: Bearer <token>` is REQUIRED for:
 *   - all writes (POST/PUT/PATCH/DELETE),
 *   - the compile GET (…/pdf — a CPU/DoS lever, gated regardless of person),
 *   - reads that expose a NON-PUBLIC person's data. A person owns not just
 *     `/persons/<id>/…` but the id-addressed resources hanging off it —
 *     `/variants/<id>` (its /resolve returns the whole CV), `/sections/<id>`,
 *     `/entries/<id>`, `/items/<id>` — so the owning person is resolved for ALL of
 *     them (getDb().ownerPersonId) and gated unless that person is on
 *     `publicPersonIds`. Non-person globals (the person LIST, /settings, /layouts,
 *     /catalog, /health) stay open for the demo; ANYTHING ELSE is denied by default,
 *     so a new person-data route can't silently leak while nobody's looking.
 *
 * NOTE: mounted at `app.use('/api', …)`, so `req.path` here is /api-stripped
 * (e.g. `/variants/10/resolve`); we tolerate a leading `/api` anyway for tests.
 */
function tokenAuth(token, { publicPersonIds = '', getDb = null, originSecret = null } = {}) {
  const publicIds = new Set(
    String(publicPersonIds)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // The owning person of an id-addressed resource, or null (unknown / no db).
  const owner = (kind, id) => {
    if (!getDb) return null;
    try {
      return getDb().ownerPersonId(kind, Number(id));
    } catch {
      return null;
    }
  };

  // Classify a GET path: {person:<id|null>} (gate unless public), {global:true}
  // (open), or null (unrecognized → default-deny).
  const classify = (raw) => {
    const path = raw.replace(/^\/api(?=\/|$)/, ''); // tolerate the /api-prefixed form
    let m;
    if ((m = path.match(/^\/persons\/(\d+)(?:\/|$)/))) return { person: Number(m[1]) };
    if ((m = path.match(/^\/variants\/(\d+)(?:\/|$)/))) return { person: owner('variant', m[1]) };
    if ((m = path.match(/^\/sections\/(\d+)(?:\/|$)/))) return { person: owner('section', m[1]) };
    if ((m = path.match(/^\/entries\/(\d+)(?:\/|$)/))) return { person: owner('entry', m[1]) };
    if ((m = path.match(/^\/items\/(\d+)(?:\/|$)/))) return { person: owner('item', m[1]) };
    if (/^\/(persons|settings|layouts|catalog|health)(?:\/|$)/.test(path)) return { global: true };
    return null; // unknown → deny
  };

  const headerOf = (req, name) =>
    (req.get ? req.get(name) : req.headers && req.headers[name.toLowerCase()]) || '';

  return function (req, res, next) {
    if (!token) return next(); // disabled → open (local dev / tests)

    // A front-door-authenticated USER (multi-tenancy phase 2): the gateway verified
    // their Google session and injected X-User-Id behind the shared front-door secret.
    // Let it through — the per-user person scoping downstream is what isolates them;
    // a direct caller can't forge X-Origin-Secret, so it can't set a trusted X-User-Id.
    if (headerOf(req, 'X-User-Id')) {
      if (!originSecret || headerOf(req, 'X-Origin-Secret') === originSecret) return next();
    }

    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isCompileGet = req.method === 'GET' && /\/pdf$/.test(req.path);

    // A read that exposes a non-public person's data (or an unrecognized read) is gated.
    let isGatedRead = false;
    if ((req.method === 'GET' || req.method === 'HEAD') && !isCompileGet) {
      const c = classify(req.path);
      if (!c) isGatedRead = true; // unrecognized route → default-deny
      else if (c.global) isGatedRead = false; // safe global → open
      else isGatedRead = !publicIds.has(String(c.person)); // person data → gate unless public (null owner → gated)
    }

    if (!isWrite && !isCompileGet && !isGatedRead) return next();

    const header = (req.get ? req.get('authorization') : req.headers && req.headers.authorization) || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (provided && provided === token) return next();

    return res.status(401).json({ error: 'Unauthorized' });
  };
}

module.exports = { tokenAuth };
