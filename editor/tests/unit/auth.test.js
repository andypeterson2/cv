const { tokenAuth } = require('../../lib/auth');

function invoke(mw, method, urlPath, authHeader) {
  const req = {
    method,
    path: urlPath,
    headers: authHeader ? { authorization: authHeader } : {},
    get(h) {
      return this.headers[h.toLowerCase()];
    },
  };
  const out = { status: 200, body: null, nexted: false };
  const res = {
    status(s) {
      out.status = s;
      return this;
    },
    json(b) {
      out.body = b;
      return this;
    },
  };
  mw(req, res, () => {
    out.nexted = true;
  });
  return out;
}

describe('tokenAuth', () => {
  test('no token configured → open (passes everything)', () => {
    const mw = tokenAuth(undefined);
    expect(invoke(mw, 'POST', '/api/profiles').nexted).toBe(true);
    expect(invoke(mw, 'GET', '/api/variants/1/pdf').nexted).toBe(true);
  });

  test('with a token: reads stay open, writes require the token', () => {
    const mw = tokenAuth('secret');
    expect(invoke(mw, 'GET', '/api/profiles').nexted).toBe(true);

    const noToken = invoke(mw, 'POST', '/api/profiles');
    expect(noToken.nexted).toBe(false);
    expect(noToken.status).toBe(401);

    const ok = invoke(mw, 'POST', '/api/profiles', 'Bearer secret');
    expect(ok.nexted).toBe(true);
  });

  test('the compile GET (/pdf) is guarded even though it is a GET', () => {
    const mw = tokenAuth('secret');
    const blocked = invoke(mw, 'GET', '/api/variants/1/pdf');
    expect(blocked.status).toBe(401);
    expect(invoke(mw, 'GET', '/api/variants/1/pdf', 'Bearer secret').nexted).toBe(true);
  });

  test('a wrong token is rejected', () => {
    const mw = tokenAuth('secret');
    expect(invoke(mw, 'DELETE', '/api/profiles/1', 'Bearer nope').status).toBe(401);
  });

  test('public-profile allowlist: demo profile reads open, other profiles gated (model C)', () => {
    const mw = tokenAuth('secret', { publicProfileIds: '1' });
    // public demo profile (1) — reads open, no token needed
    expect(invoke(mw, 'GET', '/api/profiles/1').nexted).toBe(true);
    expect(invoke(mw, 'GET', '/api/profiles/1/personal').nexted).toBe(true);
    // the profile LIST stays open
    expect(invoke(mw, 'GET', '/api/profiles').nexted).toBe(true);
    // a non-public profile (the real CV) — every read gated without the token
    expect(invoke(mw, 'GET', '/api/profiles/19').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/profiles/19/personal').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/profiles/19/export').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/profiles/19/sections').status).toBe(401);
    // …and open with the token
    expect(invoke(mw, 'GET', '/api/profiles/19/personal', 'Bearer secret').nexted).toBe(true);
  });

  // A db that resolves ownership: profile 5 (non-public) owns these; variant 91 is
  // owned by public profile 1.
  const db = {
    ownerProfileId(kind, id) {
      const owners = {
        variant: { 10: 5, 91: 1 },
        section: { 37: 5 },
        entry: { 244: 5 },
        item: { 454: 5 },
      };
      return (owners[kind] && owners[kind][id]) || null;
    },
  };
  const gated = tokenAuth('secret', { publicProfileIds: '1', getDb: () => db });

  test('id-addressed resources gate by their owning profile, not just /profiles/<id>', () => {
    // The leak this fixes: /variants/:id/resolve returned a non-public profile's whole CV, ungated.
    expect(invoke(gated, 'GET', '/api/variants/10/resolve').status).toBe(401); // owner profile 5 (non-public)
    expect(invoke(gated, 'GET', '/api/variants/10/resolve', 'Bearer secret').nexted).toBe(true);
    expect(invoke(gated, 'GET', '/api/sections/37').status).toBe(401);
    expect(invoke(gated, 'GET', '/api/entries/244').status).toBe(401);
    expect(invoke(gated, 'GET', '/api/items/454').status).toBe(401);
  });

  test("a public profile's variant stays open — the demo still works", () => {
    expect(invoke(gated, 'GET', '/api/variants/91/resolve').nexted).toBe(true); // owner profile 1 (public)
  });

  test('default-deny: an unknown resource id or unrecognized read requires the token', () => {
    expect(invoke(gated, 'GET', '/api/variants/99999/resolve').status).toBe(401); // owner unknown → null → deny
    expect(invoke(gated, 'GET', '/api/surprise/1').status).toBe(401); // unmapped route → deny
  });

  test('non-profile globals stay open without a token', () => {
    for (const p of [
      '/api/profiles',
      '/api/settings',
      '/api/settings/style',
      '/api/layouts',
      '/api/catalog',
      '/api/health',
    ]) {
      expect(invoke(gated, 'GET', p).nexted).toBe(true);
    }
  });
});
