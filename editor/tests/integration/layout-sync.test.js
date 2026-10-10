/**
 * GitHub-linked layouts against a fake GitHub: linking, the daily/manual sync,
 * versions for shared layouts, trust, and failures that keep the last good commit.
 * Verification is stubbed here (CI has no TeX); the real checks are covered by the
 * verify tests and run for real wherever xelatex is installed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'layouts-gh-'));
process.env.CV_LAYOUTS_DIR = STORE;
process.env.CV_UPLOAD_RATE_MAX = '1000';

const { startFakeGithub } = require('../helpers/fake-github');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');
const sync = require('../../lib/layout-sync');

const sha = (c) => c.repeat(40);
const bundle = (id, note = '') => ({
  'layout.json': JSON.stringify({
    id,
    name: 'Modern',
    engine: 'nunjucks',
    kinds: ['cv'],
    entry: { document: 'templates/document.tex.njk' },
  }),
  'templates/document.tex.njk': `% ${note}`,
});
const passing = async () => ({
  ok: true,
  checks: [
    { name: 'compile:fixture:cv', ok: true, ms: 800 },
    { name: 'pdf:fixture:cv', ok: true, detail: 'no active content' },
  ],
});
const failing = async () => ({
  ok: false,
  checks: [{ name: 'compile:fixture:cv', ok: false, detail: 'xelatex failed', log: '! Boom' }],
});

let gh;
let db;
let author;
let other;
let server;
let port;
const opts = (verify = passing) => ({ assetsDir: null, verify });

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
  gh = await startFakeGithub();
  process.env.CV_GITHUB_API_BASE = gh.base;
  process.env.CV_GITHUB_CODELOAD_BASE = gh.base;
  gh.repos['ada/modern'] = {
    private: false,
    defaultBranch: 'main',
    branches: { main: sha('a') },
    releases: [],
    files: { [sha('a')]: bundle('modern', 'one') },
  };
  gh.repos['ada/other'] = {
    private: false,
    defaultBranch: 'main',
    branches: { main: sha('f') },
    releases: [],
    files: { [sha('f')]: bundle('different') },
  };
  gh.repos['ada/secret'] = {
    private: true,
    defaultBranch: 'main',
    branches: { main: sha('e') },
    releases: [],
    files: {},
  };
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
  await gh.close();
  fs.rmSync(STORE, { recursive: true, force: true });
});

const family = () => `u${author}-modern`;
const push = (c, note) => {
  gh.repos['ada/modern'].branches.main = sha(c);
  gh.repos['ada/modern'].files[sha(c)] = bundle('modern', note);
};
const template = (id) =>
  fs.readFileSync(path.join(STORE, id, 'templates', 'document.tex.njk'), 'utf-8');

test('linking installs the current commit and records the source', async () => {
  const { row } = await sync.linkSource(
    db,
    author,
    { repo: 'github.com/ada/modern', track: 'branch' },
    opts(),
  );
  expect(row.id).toBe(family());
  expect(row.sourceSha).toBe(sha('a'));
  expect(template(family())).toBe('% one');
  expect(db.getLayoutSource(family())).toMatchObject({
    owner: 'ada',
    repo: 'modern',
    track: 'branch',
    lastSha: sha('a'),
    lastError: null,
  });
});

test('an unchanged branch is a no-op; a new commit updates the layout in place', async () => {
  expect(await sync.syncFamily(db, family(), opts())).toEqual({ changed: false });
  push('b', 'two');
  expect(await sync.syncFamily(db, family(), opts())).toEqual({ changed: true });
  expect(template(family())).toBe('% two');
  expect(db.familyVersions(family())).toEqual([]); // not shared: no versions
});

test('a commit that fails verification keeps the last good one and records why', async () => {
  push('c', 'broken');
  const r = await sync.syncFamily(db, family(), opts(failing));
  expect(r.changed).toBe(false);
  expect(r.error).toMatch(/main \(ccccccc\) failed/);
  expect(template(family())).toBe('% two');
  expect(db.getLayoutSource(family()).lastError).toMatch(/does not compile/);
});

test('a shared layout gets a pending version per commit, replacing an unreviewed one', async () => {
  db.setLayoutSourceFlags(family(), { shared: true });
  push('d', 'three');
  const first = await sync.syncFamily(db, family(), opts());
  expect(first.version).toBe(`${family()}@1`);
  expect(db.getLayoutUnscoped(first.version).state).toBe('pending');
  push('e', 'four');
  const second = await sync.syncFamily(db, family(), opts());
  expect(second.version).toBe(`${family()}@2`);
  expect(db.getLayoutUnscoped(first.version)).toBe(null);
  expect(db.getLayoutUnscoped(second.version).sourceSha).toBe(sha('e'));
});

test('once trusted, a passing version goes public; a skipped PDF scan still waits', async () => {
  db.setLayoutSourceFlags(family(), { trusted: true });
  push('1', 'five');
  const ok = await sync.syncFamily(db, family(), opts());
  expect(db.getLayoutUnscoped(ok.version).state).toBe('public');
  push('2', 'six');
  const skipped = await sync.syncFamily(
    db,
    family(),
    opts(async () => ({
      ok: true,
      checks: [
        { name: 'compile:fixture:cv', ok: true, ms: 800 },
        { name: 'pdf:fixture:cv', ok: true, skipped: true },
      ],
    })),
  );
  expect(db.getLayoutUnscoped(skipped.version).state).toBe('pending');
});

test('relinking to a repo with a different layout is refused, and private repos too', async () => {
  await expect(
    sync.linkSource(db, author, { repo: 'ada/other', track: 'branch', layoutId: family() }, opts()),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    sync.linkSource(db, author, { repo: 'ada/secret', track: 'branch' }, opts()),
  ).rejects.toMatchObject({ status: 403 });
});

test('a manual check is limited to once every few minutes per layout', async () => {
  await sync.syncNow(db, family(), { ...opts(), now: 1_000_000 });
  await expect(sync.syncNow(db, family(), { ...opts(), now: 1_060_000 })).rejects.toMatchObject({
    status: 429,
  });
  await expect(
    sync.syncNow(db, family(), { ...opts(), now: 1_000_000 + sync.MANUAL_SYNC_GAP_MS + 1 }),
  ).resolves.toMatchObject({ changed: false });
});

describe('routes', () => {
  test('the list shows the source, with the last error only to the author', async () => {
    db.recordLayoutSourceCheck(family(), { error: 'boom' });
    const mine = (await request('GET', '/api/layouts', undefined, author)).body.layouts.find(
      (l) => l.id === family(),
    );
    expect(mine.source).toMatchObject({ repo: 'ada/modern', track: 'branch', lastError: 'boom' });
    const pub = (await request('GET', '/api/layouts', undefined, other)).body.layouts.find(
      (l) => l.family === family(),
    );
    expect(pub.source.repo).toBe('ada/modern');
    expect(pub.source).not.toHaveProperty('lastError');
    const seen = (
      await request('GET', '/api/layouts', undefined, db.ownerUserId())
    ).body.layouts.find((l) => l.family === family());
    expect(seen.source).toHaveProperty('trusted');
  });

  test('linking a private repo is refused; only the owner may trust', async () => {
    const res = await request(
      'POST',
      '/api/layouts/link',
      { repo: 'ada/secret', track: 'branch' },
      author,
    );
    expect(res.status).toBe(403);
    expect(
      (await request('POST', `/api/layouts/${family()}/trust`, { trusted: false }, author)).status,
    ).toBe(403);
    const owner = db.ownerUserId();
    expect(
      (await request('POST', `/api/layouts/${family()}/trust`, { trusted: false }, owner)).body,
    ).toEqual({ success: true, trusted: false });
    expect(db.getLayoutSource(family()).trusted).toBe(false);
  });

  test('another account cannot sync a private family or change its source', async () => {
    db.setLayoutSourceFlags(family(), { shared: false });
    expect(
      (await request('PUT', `/api/layouts/${family()}/source`, { repo: 'ada/modern' }, other))
        .status,
    ).toBe(404);
    expect(
      (await request('DELETE', `/api/layouts/${family()}/source`, undefined, other)).status,
    ).toBe(404);
  });
});
