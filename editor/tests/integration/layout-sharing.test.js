/**
 * Shared layouts: who sees which version, who may pin it, the owner's review gate,
 * per-account reports, and pins surviving unpublish and export/import. Rows and
 * bundle directories are set up directly so nothing here needs a TeX install.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'layouts-share-'));
process.env.CV_LAYOUTS_DIR = STORE;
process.env.CV_LAYOUTS_PER_ACCOUNT = '100';
process.env.CV_PENDING_LAYOUTS = '100';

const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts, bundleChecksum } = require('../../lib/render/seed');
const { selectLayout } = require('../../lib/render/select');

let server;
let port;
let db;
let owner;
let author;
let other;

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

const enc = encodeURIComponent;
const MANIFEST = {
  id: 'modern',
  name: 'Modern',
  engine: 'nunjucks',
  contextVersion: 1,
  kinds: ['cv', 'resume'],
  entry: { document: 'templates/document.tex.njk' },
};

/** A bundle directory plus its row, as an upload or a published version. */
function layout(id, fields = {}) {
  const dir = path.join(STORE, id);
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, 'templates', 'document.tex.njk'), '% ' + id);
  db.upsertLayout({
    id,
    name: 'Modern',
    kinds: MANIFEST.kinds,
    source: 'upload',
    manifest: MANIFEST,
    checksum: bundleChecksum(dir),
    userId: author,
    family: `u${author}-modern`,
    ...fields,
  });
  return id;
}

const passingReport = (overrides = {}) => ({
  ok: true,
  checks: [
    { name: 'compile:fixture:cv', ok: true, detail: '1 page(s)', ms: 900 },
    { name: 'pdf:fixture:cv', ok: true, detail: 'no active content' },
    { name: 'compile:real:9:cv', ok: true, detail: 'author data' },
    ...(overrides.extra || []),
  ],
});

let root;
let v1;
let v2;
let v3;
let v4;
let v5;

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  owner = db.ownerUserId();
  author = db.upsertUser({ googleSub: 'sub-author', email: 'a@x.com', name: 'Ada' });
  other = db.upsertUser({ googleSub: 'sub-other', email: 'b@x.com', name: 'Bo' });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });

  root = layout(`u${author}-modern`);
  v1 = layout(`${root}@1`, {
    versionNo: 1,
    state: 'pending',
    report: passingReport(),
    compileMs: 900,
  });
  v2 = layout(`${root}@2`, { versionNo: 2, state: 'public' });
  v3 = layout(`${root}@3`, { versionNo: 3, state: 'unlisted' });
  v4 = layout(`${root}@4`, { versionNo: 4, state: 'rejected' });
  v5 = layout(`${root}@5`, { versionNo: 5, state: 'public' });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('listing', () => {
  test('another account sees builtins and public versions only, never an owner id', async () => {
    const res = await request('GET', '/api/layouts', undefined, other);
    const ids = res.body.layouts.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['awesome-cv', 'classic', v2, v5]));
    expect(ids).not.toEqual(expect.arrayContaining([root]));
    for (const id of [v1, v3, v4]) expect(ids).not.toContain(id);
    for (const l of res.body.layouts) {
      expect(l).not.toHaveProperty('userId');
      expect(l).not.toHaveProperty('reviewNote');
      expect(l).not.toHaveProperty('bytes');
    }
    const pub = res.body.layouts.find((l) => l.id === v2);
    expect(pub).toMatchObject({ own: false, author: 'Ada', state: 'public', updateAvailable: v5 });
    expect(res.body.canReview).toBe(false);
  });

  test('the author sees every row of their own, marked as theirs', async () => {
    const res = await request('GET', '/api/layouts', undefined, author);
    const mine = res.body.layouts.filter((l) => l.own).map((l) => l.id);
    for (const l of res.body.layouts.filter((x) => x.own)) {
      expect(l).toHaveProperty('reviewNote');
      expect(l).toHaveProperty('bytes');
    }
    expect(mine).toEqual(expect.arrayContaining([root, v1, v2, v3, v4, v5]));
  });

  test('only the owner can review', async () => {
    expect((await request('GET', '/api/layouts', undefined, owner)).body.canReview).toBe(true);
    expect((await request('GET', '/api/layouts/review', undefined, other)).status).toBe(403);
    const queue = await request('GET', '/api/layouts/review', undefined, owner);
    expect(queue.status).toBe(200);
    expect(queue.body.pending.map((l) => l.id)).toEqual([v1]);
  });
});

describe('reports', () => {
  test('another account reads the fixture report and only its own real-data report', async () => {
    db.setLayoutReport(v2, author, passingReport());
    db.upsertLayout({
      ...db.getLayoutUnscoped(v2),
      report: { ok: true, checks: passingReport().checks.slice(0, 2) },
    });
    const res = await request('GET', `/api/layouts/${enc(v2)}`, undefined, other);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.report)).not.toMatch(/:real:/);
    expect(res.body.myReport).toBe(null);
  });
});

describe('pinning', () => {
  test('a pending, rejected, unlisted or private row cannot be newly pinned by others', async () => {
    for (const id of [v1, v3, v4, root]) {
      const res = await request('PUT', '/api/layouts/default', { layout_id: id }, other);
      expect(res.status).toBe(404);
    }
  });

  test('a public version can be pinned, and the pin outlives unpublishing', async () => {
    const pid = db.createProfile('Bo CV', other);
    const vid = db.createVariant(pid, 'CV', 'cv');
    const res = await request('PUT', `/api/variants/${vid}/layout`, { layout_id: v2 }, other);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.warnings)).toBe(true);

    expect((await request('POST', `/api/layouts/${enc(v2)}/unpublish`, {}, other)).status).toBe(
      404,
    );
    expect((await request('POST', `/api/layouts/${enc(v2)}/unpublish`, {}, author)).status).toBe(
      200,
    );
    expect(db.getLayout(v2, other).state).toBe('unlisted');

    const variant = db.getVariant(vid);
    expect(selectLayout(db, variant, other).id).toBe(v2);
    const listed = (await request('GET', '/api/layouts', undefined, other)).body.layouts;
    expect(listed.map((l) => l.id)).not.toContain(v2);
  });

  test('deleting a public version withdraws it instead of removing it', async () => {
    const res = await request('DELETE', `/api/layouts/${enc(v5)}`, undefined, author);
    expect(res.body).toMatchObject({ success: true, unlisted: true });
    expect(db.getLayoutUnscoped(v5).state).toBe('unlisted');
    expect(fs.existsSync(path.join(STORE, v5))).toBe(true);
  });
});

describe('review', () => {
  const pending = (n, fields) =>
    layout(`${root}@${n}`, {
      versionNo: n,
      state: 'pending',
      compileMs: 900,
      report: passingReport(),
      ...fields,
    });

  test('approval needs unchanged files, a passing PDF scan and a fast compile', async () => {
    const changed = pending(10);
    fs.writeFileSync(path.join(STORE, changed, 'templates', 'document.tex.njk'), '% changed');
    const skipped = pending(11, {
      report: { ok: true, checks: [{ name: 'pdf:fixture:cv', ok: true, skipped: true }] },
    });
    const slow = pending(12, { compileMs: 60000 });
    for (const id of [changed, skipped, slow]) {
      const res = await request(
        'POST',
        `/api/layouts/${enc(id)}/review`,
        { decision: 'approve' },
        owner,
      );
      expect(res.status).toBe(409);
      expect(db.getLayoutUnscoped(id).state).toBe('pending');
    }
  });

  test('the owner approves or rejects; nobody else can', async () => {
    const good = pending(13);
    const bad = pending(14);
    expect(
      (await request('POST', `/api/layouts/${enc(good)}/review`, { decision: 'approve' }, author))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          'POST',
          `/api/layouts/${enc(good)}/review`,
          { decision: 'approve', note: 'ok' },
          owner,
        )
      ).body.state,
    ).toBe('public');
    expect(db.getLayoutUnscoped(good)).toMatchObject({ state: 'public', reviewNote: 'ok' });
    expect(
      (
        await request(
          'POST',
          `/api/layouts/${enc(bad)}/review`,
          { decision: 'reject', note: 'no' },
          owner,
        )
      ).body.state,
    ).toBe('rejected');
  });
});

describe('export and import', () => {
  test('a pin survives a round trip when the importer can still use the layout', () => {
    const pid = db.createProfile('Pinned', other);
    const vid = db.createVariant(pid, 'CV', 'cv');
    db.setVariantLayout(vid, v3); // unlisted: resolvable for compiles
    const privateVid = db.createVariant(pid, 'Private pin', 'cv');
    db.setVariantLayout(privateVid, root);

    const data = db.getProfileExport(pid);
    expect(data.variants.find((v) => v.name === 'CV').layout).toEqual({
      id: v3,
      family: root,
      versionNo: 3,
    });
    const copy = db.createProfile('Copy', other);
    db.importProfileData(copy, data);
    const byName = Object.fromEntries(db.getVariants(copy).map((v) => [v.name, v]));
    expect(byName.CV.layoutId).toBe(v3);
    expect(byName['Private pin'].layoutId).toBe(null);
  });
});

const { execFileSync } = require('child_process');
const canCompile = (() => {
  try {
    execFileSync('xelatex', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!canCompile)('publishing (real compile)', () => {
  test('publishing snapshots the upload as the next pending version', async () => {
    const id = `u${author}-classic-copy`;
    fs.cpSync(path.join(__dirname, '..', '..', 'layouts', 'classic'), path.join(STORE, id), {
      recursive: true,
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(STORE, id, 'layout.json'), 'utf-8'));
    db.upsertLayout({
      id,
      name: 'Classic copy',
      kinds: manifest.kinds,
      source: 'upload',
      manifest,
      checksum: bundleChecksum(path.join(STORE, id)),
      userId: author,
    });
    const res = await request('POST', `/api/layouts/${enc(id)}/publish`, {}, author);
    expect(res.status).toBe(201);
    expect(res.body.layout).toMatchObject({
      id: `${id}@1`,
      state: 'pending',
      versionNo: 1,
      own: true,
    });
    const row = db.getLayoutUnscoped(`${id}@1`);
    expect(row.compileMs).toBeGreaterThan(0);
    expect(row.checksum).toBe(bundleChecksum(path.join(STORE, `${id}@1`)));
    expect(
      (await request('POST', `/api/layouts/${enc(`${id}@1`)}/publish`, {}, author)).status,
    ).toBe(409);
  }, 300_000);
});

describe('freeing space', () => {
  test('an unlisted version nobody uses can be deleted for real', async () => {
    const id = layout(`${root}@40`, { versionNo: 40, state: 'unlisted' });
    const res = await request('DELETE', `/api/layouts/${enc(id)}`, undefined, author);
    expect(res.body).toEqual({ success: true });
    expect(db.getLayoutUnscoped(id)).toBe(null);
    expect(fs.existsSync(path.join(STORE, id))).toBe(false);
  });
});
