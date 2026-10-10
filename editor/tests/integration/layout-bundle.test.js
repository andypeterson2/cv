/**
 * Layout downloads: a zip of exactly the layouts the caller may use.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const extract = require('extract-zip');

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'layouts-bundle-'));
process.env.CV_LAYOUTS_DIR = STORE;

const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts, bundleChecksum } = require('../../lib/render/seed');

let server;
let port;
let db;
let author;
let other;

function send(method, urlPath, { userId, json } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let payload = null;
    if (json !== undefined) {
      payload = Buffer.from(JSON.stringify(json));
      headers['Content-Type'] = 'application/json';
    }
    if (payload) headers['Content-Length'] = payload.length;
    if (userId != null) headers['X-User-Id'] = String(userId);
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let body = buf;
          if ((res.headers['content-type'] || '').includes('json'))
            body = JSON.parse(buf.toString());
          resolve({ status: res.statusCode, headers: res.headers, body });
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
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  author = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com', name: 'Ada' });
  other = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com', name: 'Bo' });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('GET /api/layouts/:id/bundle', () => {
  const store = (id, fields) => {
    const dir = path.join(STORE, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ id: 'x', kinds: ['cv'] }));
    db.upsertLayout({
      id,
      kinds: ['cv'],
      source: 'upload',
      userId: author,
      checksum: bundleChecksum(dir),
      family: `u${author}-x`,
      ...fields,
    });
    return id;
  };

  test('a builtin downloads as a zip holding its manifest', async () => {
    const res = await send('GET', '/api/layouts/classic/bundle', { userId: other });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toMatch(/classic\.zip/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-'));
    const zip = path.join(dir, 'b.zip');
    fs.writeFileSync(zip, res.body);
    await extract(zip, { dir: path.join(dir, 'out') });
    expect(fs.existsSync(path.join(dir, 'out', 'layout.json'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('another account gets public versions and pinned unlisted ones only', async () => {
    const priv = store(`u${author}-x`, {});
    const pub = store(`u${author}-x@1`, { versionNo: 1, state: 'public' });
    const unlisted = store(`u${author}-x@2`, { versionNo: 2, state: 'unlisted' });
    const get = (id) =>
      send('GET', `/api/layouts/${encodeURIComponent(id)}/bundle`, { userId: other });
    expect((await get(priv)).status).toBe(404);
    expect((await get(pub)).status).toBe(200);
    expect((await get(pub)).headers['content-disposition']).toMatch(/-v1\.zip/);
    expect((await get(unlisted)).status).toBe(404);
    const pid = db.createProfile('Bo', other);
    db.setVariantLayout(db.createVariant(pid, 'CV', 'cv'), unlisted);
    expect((await get(unlisted)).status).toBe(200);
    expect(
      (await send('GET', `/api/layouts/${encodeURIComponent(priv)}/bundle`, { userId: author }))
        .status,
    ).toBe(200);
  });
});
