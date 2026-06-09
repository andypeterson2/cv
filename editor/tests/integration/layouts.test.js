/**
 * Integration tests for the layouts API + per-variant layout selection (P1).
 */
const http = require('http');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');

let server;
let port;
let db;
let pid;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  pid = db.createPerson('Test');
  await new Promise((resolve) => { server = app.listen(0, () => { port = server.address().port; resolve(); }); });
});

afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

describe('GET /api/layouts', () => {
  it('lists installed layouts and the current default', async () => {
    const res = await request('GET', '/api/layouts');
    expect(res.status).toBe(200);
    expect(res.body.default).toBe('awesome-cv');
    expect(res.body.layouts.some((l) => l.id === 'awesome-cv' && l.builtin)).toBe(true);
  });

  it('returns a single layout with its manifest', async () => {
    const res = await request('GET', '/api/layouts/awesome-cv');
    expect(res.status).toBe(200);
    expect(res.body.manifest.id).toBe('awesome-cv');
  });

  it('404s an unknown layout', async () => {
    const res = await request('GET', '/api/layouts/nope');
    expect(res.status).toBe(404);
  });
});

describe('global default selection', () => {
  it('rejects setting a default to a nonexistent layout', async () => {
    const res = await request('PUT', '/api/layouts/default', { layout_id: 'ghost' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/variants/:id/layout', () => {
  let vid;
  beforeAll(() => { vid = db.createVariant(pid, 'CV', 'cv'); });

  it('sets a variant layout to an installed layout', async () => {
    const res = await request('PUT', `/api/variants/${vid}/layout`, { layout_id: 'awesome-cv' });
    expect(res.status).toBe(200);
    expect(res.body.layout_id).toBe('awesome-cv');
    const got = await request('GET', `/api/variants/${vid}`);
    expect(got.body.layoutId).toBe('awesome-cv');
  });

  it('reverts to default with layout_id null', async () => {
    const res = await request('PUT', `/api/variants/${vid}/layout`, { layout_id: null });
    expect(res.status).toBe(200);
    expect(res.body.layout_id).toBe(null);
  });

  it('rejects an unknown layout', async () => {
    const res = await request('PUT', `/api/variants/${vid}/layout`, { layout_id: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('rejects a layout that does not support the variant kind', async () => {
    db.upsertLayout({ id: 'cvonly', name: 'CV Only', kinds: ['cv'], source: 'upload' });
    const clv = db.createVariant(pid, 'Letter', 'coverletter');
    const res = await request('PUT', `/api/variants/${clv}/layout`, { layout_id: 'cvonly' });
    expect(res.status).toBe(409);
  });
});
