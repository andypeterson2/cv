const { originGuard } = require('../../lib/origin-guard');

function invoke(mw, method, urlPath, secretHeader) {
  const req = {
    method,
    path: urlPath,
    headers: secretHeader ? { 'x-origin-secret': secretHeader } : {},
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

/** A guard whose log calls are captured rather than printed. */
function guard(secret, enforce) {
  const logs = [];
  const mw = originGuard(secret, { enforce, log: (m) => logs.push(m) });
  return { mw, logs };
}

describe('originGuard', () => {
  test('no secret configured → open (local dev / tests)', () => {
    const { mw } = guard(undefined, true);
    expect(invoke(mw, 'GET', '/api/persons/5').nexted).toBe(true);
    expect(invoke(mw, 'POST', '/api/persons').nexted).toBe(true);
  });

  test('soft mode: a missing secret is logged but ALLOWED (so front doors can catch up)', () => {
    const { mw, logs } = guard('s3cret', false);
    const res = invoke(mw, 'GET', '/api/persons/5');
    expect(res.nexted).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/soft.*GET \/api\/persons\/5/);
  });

  test('soft mode: the correct secret passes silently', () => {
    const { mw, logs } = guard('s3cret', false);
    expect(invoke(mw, 'GET', '/api/persons/5', 's3cret').nexted).toBe(true);
    expect(logs).toHaveLength(0);
  });

  test('enforcing: missing or wrong secret → 403; correct → through', () => {
    const { mw } = guard('s3cret', true);
    const missing = invoke(mw, 'GET', '/api/variants/10/resolve');
    expect(missing.nexted).toBe(false);
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });

    expect(invoke(mw, 'GET', '/api/variants/10/resolve', 'wrong').status).toBe(403);
    expect(invoke(mw, 'GET', '/api/variants/10/resolve', 's3cret').nexted).toBe(true);
  });

  test('health stays open even when enforcing — the container HEALTHCHECK has no header', () => {
    const { mw } = guard('s3cret', true);
    for (const p of ['/health', '/api/health', '/health/']) {
      expect(invoke(mw, 'GET', p).nexted).toBe(true);
    }
    // …but a health-lookalike is not exempt
    expect(invoke(mw, 'GET', '/api/healthz').status).toBe(403);
  });

  test('OPTIONS preflight is exempt', () => {
    const { mw } = guard('s3cret', true);
    expect(invoke(mw, 'OPTIONS', '/api/persons/5').nexted).toBe(true);
  });

  test('enforcing: a comma-separated SET accepts ANY listed secret (zero-downtime rotation)', () => {
    const { mw } = guard('old , new', true); // set cv to "old,new" mid-rotation
    expect(invoke(mw, 'GET', '/api/variants/10/resolve', 'old').nexted).toBe(true); // a sender still on old works
    expect(invoke(mw, 'GET', '/api/variants/10/resolve', 'new').nexted).toBe(true); // a sender flipped to new works
    expect(invoke(mw, 'GET', '/api/variants/10/resolve', 'gone').status).toBe(403); // a dropped/unknown value → 403
  });
});
