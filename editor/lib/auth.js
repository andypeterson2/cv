/**
 * Optional shared-token auth (defense in depth; the public app is fronted by the
 * gateway but the backend is also directly reachable, so this is the real gate).
 *
 * No-op unless CV_EDITOR_TOKEN is set (local dev + tests stay open). When set,
 * `Authorization: Bearer <token>` is REQUIRED for:
 *   - all writes (POST/PUT/PATCH/DELETE),
 *   - the compile GET (…/pdf — a CPU/DoS lever),
 *   - reads of a NON-PUBLIC person — every GET under `/persons/<id>` whose id is
 *     not listed in publicPersonIds. This gates the owner's real CV (name / email /
 *     phone / address + content) while leaving the demo person (e.g. Jane Doe), the
 *     person LIST, global style `/settings`, `/health`, and `/api` open for the
 *     public demo (model C).
 *
 * NOTE: mounted at `app.use('/api', …)`, so `req.path` here is /api-stripped
 * (e.g. `/persons/19/personal`).
 */
function tokenAuth(token, { publicPersonIds = '' } = {}) {
  const publicIds = new Set(
    String(publicPersonIds)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return function (req, res, next) {
    if (!token) return next(); // disabled → open (local dev / tests)

    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isCompileGet = req.method === 'GET' && /\/pdf$/.test(req.path);

    // A read of a person whose id is not on the public allowlist is gated.
    let isGatedRead = false;
    if (req.method === 'GET') {
      const m = req.path.match(/^(?:\/api)?\/persons\/(\d+)(?:\/|$)/);
      if (m && !publicIds.has(m[1])) isGatedRead = true;
    }

    if (!isWrite && !isCompileGet && !isGatedRead) return next();

    const header = (req.get ? req.get('authorization') : req.headers && req.headers.authorization) || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (provided && provided === token) return next();

    return res.status(401).json({ error: 'Unauthorized' });
  };
}

module.exports = { tokenAuth };
