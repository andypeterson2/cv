/**
 * Optional shared-token auth (defense in depth behind the reverse proxy).
 *
 * Returns an Express middleware that guards state-changing requests (and the
 * compile GET, which is a CPU DoS lever) with `Authorization: Bearer <token>`
 * when a token is configured via CV_EDITOR_TOKEN. When no token is set it is a
 * no-op, so local dev and the existing tests keep working unauthenticated.
 */
function tokenAuth(token) {
  return function (req, res, next) {
    if (!token) return next(); // disabled → open (local dev / behind Caddy only)

    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isCompileGet = req.method === 'GET' && /\/pdf$/.test(req.path);
    if (!isWrite && !isCompileGet) return next();

    const header = (req.get ? req.get('authorization') : req.headers && req.headers.authorization) || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (provided && provided === token) return next();

    return res.status(401).json({ error: 'Unauthorized' });
  };
}

module.exports = { tokenAuth };
