/**
 * Integration tests for the version-history endpoints (ADR-006 increment 1):
 * POST/GET /persons/:pid/versions and POST /persons/:pid/versions/:vid/restore.
 * In-memory DB; tokenAuth is disabled (no CV_EDITOR_TOKEN) so these cover routing,
 * validation, and the snapshot→restore round-trip over HTTP — the auth gating is
 * covered by the auth unit tests.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
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
beforeEach(async () => {
  db.clearAllContent();
  pid = Number((await request('POST', '/api/persons', { name: 'Test' })).body.id);
});

const addSection = async (slug) =>
  (await request('POST', `/api/persons/${pid}/sections`, { slug, type: slug, title: slug })).body.id;

describe('Version endpoints', () => {
  test('snapshot → list → restore round-trips over HTTP', async () => {
    await addSection('experience');
    const before = (await request('GET', `/api/persons/${pid}/export`)).body;

    const create = await request('POST', `/api/persons/${pid}/versions`, { label: 'checkpoint' });
    expect(create.status).toBe(201);
    const vid = create.body.id;

    // diverge from the checkpoint
    await addSection('skills');
    expect((await request('GET', `/api/persons/${pid}`)).body.sections).toHaveLength(2);

    const list = await request('GET', `/api/persons/${pid}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.versions.map((v) => v.label)).toEqual(['checkpoint']);
    expect(typeof list.body.versions[0].createdAt).toBe('number');

    const restore = await request('POST', `/api/persons/${pid}/versions/${vid}/restore`);
    expect(restore.status).toBe(200);
    expect((await request('GET', `/api/persons/${pid}/export`)).body).toEqual(before);
    expect((await request('GET', `/api/persons/${pid}`)).body.sections).toHaveLength(1);
  });

  test('a client-sent doc is stripped — the server snapshots its own state', async () => {
    await addSection('experience');
    const res = await request('POST', `/api/persons/${pid}/versions`, {
      label: 'x',
      doc: { evil: true },
    });
    expect(res.status).toBe(201);
    const doc = db.getVersionDoc(pid, res.body.id);
    expect(doc.evil).toBeUndefined();
    expect(Array.isArray(doc.sections)).toBe(true);
  });

  test('an untitled snapshot works', async () => {
    await addSection('experience');
    const res = await request('POST', `/api/persons/${pid}/versions`, {});
    expect(res.status).toBe(201);
    expect((await request('GET', `/api/persons/${pid}/versions`)).body.versions[0].label).toBe('');
  });

  test('restoring an unknown version is 404', async () => {
    const res = await request('POST', `/api/persons/${pid}/versions/99999/restore`);
    expect(res.status).toBe(404);
  });

  test('GET one version returns its full doc (for the diff); 404 for unknown', async () => {
    await addSection('experience');
    const vid = (await request('POST', `/api/persons/${pid}/versions`, { label: 'cp' })).body.id;
    const res = await request('GET', `/api/persons/${pid}/versions/${vid}`);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('cp');
    expect(typeof res.body.createdAt).toBe('number');
    expect(Array.isArray(res.body.doc.sections)).toBe(true);
    expect((await request('GET', `/api/persons/${pid}/versions/99999`)).status).toBe(404);
  });
});
