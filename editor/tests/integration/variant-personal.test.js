/**
 * Integration tests for the per-variant personal.* routes and the ownership gate
 * on /variants/:id. Requests name their user with X-User-Id, which attachUser
 * trusts when no CV_ORIGIN_SECRET is configured (as in these tests).
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

describe('per-variant personal routes', () => {
  test('PATCH then GET returns the override, and /resolve renders it', async () => {
    expect((await request('GET', `/api/variants/${vid}/personal`)).body).toEqual({});

    const patch = await request('PATCH', `/api/variants/${vid}/personal`, {
      position: 'Variant Tagline',
    });
    expect(patch.status).toBe(200);

    expect((await request('GET', `/api/variants/${vid}/personal`)).body).toEqual({
      position: 'Variant Tagline',
    });
    expect((await request('GET', `/api/variants/${vid}`)).body.personal).toEqual({
      position: 'Variant Tagline',
    });
    expect((await request('GET', `/api/variants/${vid}/resolve`)).body.personal.position).toBe(
      'Variant Tagline',
    );
  });

  test('null clears the override, so the person value comes back', async () => {
    await request('PATCH', `/api/variants/${vid}/personal`, { position: 'Variant Tagline' });
    await request('PATCH', `/api/variants/${vid}/personal`, { position: null });
    expect((await request('GET', `/api/variants/${vid}/personal`)).body).toEqual({});
    expect((await request('GET', `/api/variants/${vid}/resolve`)).body.personal.position).toBe(
      'Person Tagline',
    );
  });

  test('an empty string is kept and suppresses the field', async () => {
    await request('PATCH', `/api/variants/${vid}/personal`, { position: '' });
    expect((await request('GET', `/api/variants/${vid}/resolve`)).body.personal.position).toBe('');
  });

  test('overrides are per variant', async () => {
    const other = Number(
      (await request('POST', `/api/persons/${pid}/variants`, { name: 'QC', kind: 'resume' })).body
        .id,
    );
    await request('PATCH', `/api/variants/${vid}/personal`, { position: 'ML Tagline' });
    expect((await request('GET', `/api/variants/${other}/personal`)).body).toEqual({});
  });

  test('an empty PATCH is rejected, and a non-string non-null value too', async () => {
    expect((await request('PATCH', `/api/variants/${vid}/personal`, {})).status).toBe(400);
    expect((await request('PATCH', `/api/variants/${vid}/personal`, { position: 3 })).status).toBe(
      400,
    );
    // A key outside the pattern is stripped by ajv (removeAdditional), as on the
    // person route, so the request succeeds and writes nothing.
    expect(
      (await request('PATCH', `/api/variants/${vid}/personal`, { 'bad key': 'x' })).status,
    ).toBe(200);
    expect((await request('GET', `/api/variants/${vid}/personal`)).body).toEqual({});
  });

  test('a missing variant 404s', async () => {
    expect((await request('GET', '/api/variants/999999/personal')).status).toBe(404);
    expect(
      (await request('PATCH', '/api/variants/999999/personal', { position: 'x' })).status,
    ).toBe(404);
  });
});

describe('ownership gate on /variants/:id', () => {
  let stranger;
  beforeEach(() => {
    stranger = db.upsertUser({ googleSub: 'sub-stranger', email: 's@x.com', name: 'S' });
  });

  test('another user cannot read a variant or its tagline', async () => {
    await request('PATCH', `/api/variants/${vid}/personal`, { position: 'Variant Tagline' });
    expect((await request('GET', `/api/variants/${vid}`, undefined, stranger)).status).toBe(404);
    expect(
      (await request('GET', `/api/variants/${vid}/personal`, undefined, stranger)).status,
    ).toBe(404);
    expect((await request('GET', `/api/variants/${vid}/resolve`, undefined, stranger)).status).toBe(
      404,
    );
  });

  test('another user cannot write the tagline, rename, or delete the variant', async () => {
    expect(
      (await request('PATCH', `/api/variants/${vid}/personal`, { position: 'hijacked' }, stranger))
        .status,
    ).toBe(404);
    expect(
      (await request('PUT', `/api/variants/${vid}`, { name: 'hijacked' }, stranger)).status,
    ).toBe(404);
    expect((await request('DELETE', `/api/variants/${vid}`, undefined, stranger)).status).toBe(404);

    // The variant is untouched.
    expect((await request('GET', `/api/variants/${vid}`)).body.name).toBe('ML');
    expect((await request('GET', `/api/variants/${vid}/personal`)).body).toEqual({});
  });

  test('another user cannot rewrite rules, sections, or overrides', async () => {
    expect(
      (await request('PUT', `/api/variants/${vid}/rules`, { include: ['x'] }, stranger)).status,
    ).toBe(404);
    expect(
      (await request('PUT', `/api/variants/${vid}/sections`, { sections: [] }, stranger)).status,
    ).toBe(404);
    expect((await request('GET', `/api/variants/${vid}`)).body.rules.include).toEqual([]);
  });
});
