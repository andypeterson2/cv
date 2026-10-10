/**
 * Integration tests for the per-variant style/spacing/fonts routes and their merge
 * over the account settings at resolve time.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

function request(method, urlPath, body, userId) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (userId != null) headers['X-User-Id'] = String(userId);
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  app.setDb(db);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

let pid;
let vid;
beforeEach(async () => {
  db.clearAllContent();
  pid = Number((await request('POST', '/api/persons', { name: 'Test' })).body.id);
  db.setPersonal(pid, { firstName: 'Test', lastName: 'Person', position: 'Person Tagline' });
  vid = Number(
    (await request('POST', `/api/persons/${pid}/variants`, { name: 'ML', kind: 'resume' })).body.id,
  );
});

describe('per-variant settings routes', () => {
  test('PATCH then GET returns the override, and /resolve merges it over the account', async () => {
    await request('PATCH', '/api/settings', { 'spacing.marginTop': { num: 1, unit: 'cm' } });
    expect((await request('GET', `/api/variants/${vid}/settings`)).body).toEqual({});

    const patch = await request('PATCH', `/api/variants/${vid}/settings`, {
      'spacing.marginTop': { num: 4, unit: 'mm' },
      'style.fontFamily': 'roboto',
    });
    expect(patch.status).toBe(200);

    expect((await request('GET', `/api/variants/${vid}`)).body.settings).toEqual({
      'spacing.marginTop': { num: 4, unit: 'mm' },
      'style.fontFamily': 'roboto',
    });
    const r = (await request('GET', `/api/variants/${vid}/resolve`)).body;
    expect(r.spacing.marginTop).toBe('4mm');
    expect(r.style.fontFamily).toBe('roboto');
  });

  test('null clears the override, so the account value comes back', async () => {
    await request('PATCH', '/api/settings', { 'spacing.marginTop': { num: 1, unit: 'cm' } });
    await request('PATCH', `/api/variants/${vid}/settings`, {
      'spacing.marginTop': { num: 4, unit: 'mm' },
    });
    await request('PATCH', `/api/variants/${vid}/settings`, { 'spacing.marginTop': null });
    expect((await request('GET', `/api/variants/${vid}/resolve`)).body.spacing.marginTop).toBe(
      '1cm',
    );
  });

  test('account null resets the key', async () => {
    await request('PATCH', '/api/settings', { 'style.fontFamily': 'roboto' });
    expect((await request('PATCH', '/api/settings', { 'style.fontFamily': null })).status).toBe(
      200,
    );
    expect((await request('GET', '/api/settings?prefix=style')).body).toEqual({});
  });

  test('rejects a bad unit and writes nothing for keys outside style/spacing/fonts', async () => {
    expect(
      (
        await request('PATCH', `/api/variants/${vid}/settings`, {
          'spacing.marginTop': { num: 1, unit: 'furlong' },
        })
      ).status,
    ).toBe(400);
    expect((await request('PATCH', `/api/variants/${vid}/settings`, {})).status).toBe(400);
    await request('PATCH', `/api/variants/${vid}/settings`, { 'layout.default': 'x' });
    expect((await request('GET', `/api/variants/${vid}/settings`)).body).toEqual({});
  });

  test('another user cannot read or change the overrides', async () => {
    const stranger = db.upsertUser({ googleSub: 'sub-s2', email: 's2@x.com', name: 'S' });
    const sid = stranger.id ?? stranger;
    expect((await request('GET', `/api/variants/${vid}/settings`, undefined, sid)).status).toBe(
      404,
    );
    expect(
      (
        await request(
          'PATCH',
          `/api/variants/${vid}/settings`,
          { 'style.fontFamily': 'roboto' },
          sid,
        )
      ).status,
    ).toBe(404);
  });
});
