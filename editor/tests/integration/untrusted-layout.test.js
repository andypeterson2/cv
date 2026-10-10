/**
 * An uploaded layout's templates are another account's code, so a compile renders
 * them in the worker: a template that never finishes is cut off by the worker's
 * timeout instead of blocking the server for every account.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'layouts-store-'));
process.env.CV_LAYOUTS_DIR = STORE;

const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');

let server;
let port;
let db;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: 'localhost', port, path: urlPath }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      })
      .on('error', reject);
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
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
  fs.rmSync(STORE, { recursive: true, force: true });
});

test('a runaway uploaded template is stopped by the worker timeout', async () => {
  const owner = db.ownerUserId();
  const id = `u${owner}-spin`;
  const manifest = {
    id: 'spin',
    name: 'Spin',
    engine: 'nunjucks',
    contextVersion: 1,
    kinds: ['cv'],
    entry: { document: 'templates/document.tex.njk' },
  };
  const dir = path.join(STORE, id);
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(dir, 'templates', 'document.tex.njk'),
    '<% for i in range(0, 100000) %><% for j in range(0, 100000) %><% endfor %><% endfor %>',
  );
  db.upsertLayout({ id, kinds: ['cv'], source: 'upload', manifest, userId: owner });

  const pid = db.createProfile('Runaway');
  const vid = db.createVariant(pid, 'CV', 'cv');
  db.setVariantLayout(vid, id);

  const started = Date.now();
  const pending = get(`/api/variants/${vid}/pdf`);
  // The server keeps answering while that render runs.
  const health = await get('/api/health');
  expect(health.status).toBe(200);
  expect(Date.now() - started).toBeLessThan(2000);

  const res = await pending;
  expect(res.status).toBe(500);
  expect(res.body).toMatch(/timed out|timeout/i);
}, 30_000);
