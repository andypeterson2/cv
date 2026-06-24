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
    expect(invoke(mw, 'POST', '/api/persons').nexted).toBe(true);
    expect(invoke(mw, 'GET', '/api/variants/1/pdf').nexted).toBe(true);
  });

  test('with a token: reads stay open, writes require the token', () => {
    const mw = tokenAuth('secret');
    expect(invoke(mw, 'GET', '/api/persons').nexted).toBe(true);

    const noToken = invoke(mw, 'POST', '/api/persons');
    expect(noToken.nexted).toBe(false);
    expect(noToken.status).toBe(401);

    const ok = invoke(mw, 'POST', '/api/persons', 'Bearer secret');
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
    expect(invoke(mw, 'DELETE', '/api/persons/1', 'Bearer nope').status).toBe(401);
  });

  test('public-person allowlist: demo person reads open, other persons gated (model C)', () => {
    const mw = tokenAuth('secret', { publicPersonIds: '1' });
    // public demo person (1) — reads open, no token needed
    expect(invoke(mw, 'GET', '/api/persons/1').nexted).toBe(true);
    expect(invoke(mw, 'GET', '/api/persons/1/personal').nexted).toBe(true);
    // the person LIST stays open
    expect(invoke(mw, 'GET', '/api/persons').nexted).toBe(true);
    // a non-public person (the real CV) — every read gated without the token
    expect(invoke(mw, 'GET', '/api/persons/19').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/persons/19/personal').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/persons/19/export').status).toBe(401);
    expect(invoke(mw, 'GET', '/api/persons/19/sections').status).toBe(401);
    // …and open with the token
    expect(invoke(mw, 'GET', '/api/persons/19/personal', 'Bearer secret').nexted).toBe(true);
  });
});
