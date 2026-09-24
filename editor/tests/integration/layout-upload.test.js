/**
 * Upload + management API. Covers the rejection paths that fail at the
 * static/security gate before the dynamic xelatex step, so they run without a
 * TeX install. The happy path (which compiles) is covered by the verify unit
 * tests (stubbed compile) + the in-container smoke.
 *
 * Builds real .zip bundles with the `zip` CLI; skips if it isn't available.
 */
// The default upload limit (5/min) is spent by the rejection cases below, and these
// all run against one server, so lift it before the router reads it at construction.
process.env.CV_UPLOAD_RATE_MAX = '1000';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');

let hasZip = true;
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  hasZip = false;
}

let server, port, db, tmp;

function makeZip(name, files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'z-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const zipPath = path.join(tmp, name);
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: dir });
  return zipPath;
}

async function uploadZip(zipPath) {
  const form = new FormData();
  if (zipPath)
    form.append(
      'bundle',
      new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }),
      path.basename(zipPath),
    );
  const res = await fetch(`http://localhost:${port}/api/layouts`, {
    method: 'POST',
    body: zipPath ? form : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function del(id) {
  return new Promise((resolve) => {
    http
      .request(
        { hostname: 'localhost', port, path: `/api/layouts/${id}`, method: 'DELETE' },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        },
      )
      .end();
  });
}

const MANIFEST = (over = {}) =>
  JSON.stringify({
    id: 'cand',
    name: 'Cand',
    engine: 'nunjucks',
    contextVersion: 1,
    kinds: ['cv'],
    entry: { document: 'templates/document.tex.njk' },
    ...over,
  });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  await new Promise((r) => {
    server = app.listen(0, () => {
      port = server.address().port;
      r();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('POST /api/layouts (rejection paths)', () => {
  it('400 when no file is provided', async () => {
    const { status } = await uploadZip(null);
    expect(status).toBe(400);
  });

  it.skipIf(!hasZip)('422 when the zip has no layout.json', async () => {
    const zip = makeZip('noroot.zip', { 'readme.txt': 'hi' });
    const { status } = await uploadZip(zip);
    expect(status).toBe(422);
  });

  it.skipIf(!hasZip)('422 + security report for a \\write18 bundle', async () => {
    const zip = makeZip('sec.zip', {
      'layout.json': MANIFEST(),
      'templates/document.tex.njk':
        '\\documentclass{article}\\begin{document}\\write18{id}\\end{document}',
    });
    const { status, body } = await uploadZip(zip);
    expect(status).toBe(422);
    expect(body.error.code).toBe('verification_failed');
    expect(body.error.details.checks.find((c) => c.name === 'security').ok).toBe(false);
  });

  it.skipIf(!hasZip)('422 for an invalid manifest (missing entry)', async () => {
    const bad = JSON.parse(MANIFEST());
    delete bad.entry;
    const zip = makeZip('badman.zip', {
      'layout.json': JSON.stringify(bad),
      'templates/document.tex.njk': 'x',
    });
    const { status } = await uploadZip(zip);
    expect(status).toBe(422);
  });

  it.skipIf(!hasZip)('409 when the id collides with a builtin', async () => {
    const zip = makeZip('collide.zip', {
      'layout.json': MANIFEST({ id: 'awesome-cv' }),
      'templates/document.tex.njk': 'x',
    });
    const { status } = await uploadZip(zip);
    expect(status).toBe(409);
  });

  it('none of the rejected bundles were installed', async () => {
    const res = await fetch(`http://localhost:${port}/api/layouts`);
    const { layouts } = await res.json();
    expect(layouts.filter((l) => l.source === 'upload')).toEqual([]); // nothing got installed
    expect(layouts.some((l) => l.id === 'awesome-cv')).toBe(true); // builtins intact
  });
});

describe('DELETE /api/layouts/:id', () => {
  it('refuses to delete a builtin (409)', async () => {
    expect(await del('awesome-cv')).toBe(409);
  });
  it('404 for an unknown layout', async () => {
    expect(await del('ghost')).toBe(404);
  });
});

describe('layout ids', () => {
  it.skipIf(!hasZip)('422 for a manifest id that is not a slug', async () => {
    const zip = makeZip('escape.zip', {
      'layout.json': MANIFEST({ id: '../escape' }),
      'templates/document.tex.njk': 'x',
    });
    const { status } = await uploadZip(zip);
    expect(status).toBe(422);
    // Nothing outside the layouts store was touched, and no row was created.
    expect(db.listLayouts(db.ownerUserId()).some((l) => l.id.includes('escape'))).toBe(false);
  });

  it('stores an upload under an id that carries the installer', () => {
    // Two accounts installing the same manifest id must not collide on the
    // layouts primary key, which the bare manifest id would.
    const a = db.upsertUser({ googleSub: 'g-a', email: 'a@x.test' });
    const b = db.upsertUser({ googleSub: 'g-b', email: 'b@x.test' });
    db.upsertLayout({ id: `u${a}-modern`, name: 'M', kinds: ['cv'], source: 'upload', userId: a });
    db.upsertLayout({ id: `u${b}-modern`, name: 'M', kinds: ['cv'], source: 'upload', userId: b });
    expect(db.listLayouts(a).map((l) => l.id)).toContain(`u${a}-modern`);
    expect(db.listLayouts(a).map((l) => l.id)).not.toContain(`u${b}-modern`);
    expect(db.listLayouts(b).map((l) => l.id)).toContain(`u${b}-modern`);
  });

  it('re-verifying updates the row in place instead of adding a second one', async () => {
    // The row id carries the installer; its manifest keeps the bare id it was
    // authored with. Re-upserting by the manifest id would insert a duplicate.
    const owner = db.ownerUserId();
    const storedId = `u${owner}-cand`;
    db.upsertLayout({
      id: storedId,
      name: 'Cand',
      kinds: ['cv'],
      source: 'upload',
      userId: owner,
      manifest: { id: 'cand', name: 'Cand', engine: 'nunjucks', kinds: ['cv'], entry: {} },
    });
    const before = db.listLayouts(owner).length;

    // No bundle on disk, so verification fails at the static stage — no xelatex needed.
    const res = await fetch(`http://localhost:${port}/api/layouts/${storedId}/verify`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);

    const after = db.listLayouts(owner);
    expect(after.length).toBe(before);
    expect(after.filter((l) => l.id === storedId)).toHaveLength(1);
    expect(after.some((l) => l.id === 'cand')).toBe(false);
    expect(db.getLayout(storedId, owner).status).toBe('invalid');
    db.deleteLayout(storedId, owner);
  });
});

describe('symbolic links in an uploaded bundle', () => {
  // extract-zip (2.0.1, no patched release) creates symlink entries from the archive.
  // It blocks a write *through* one, but the link itself lands on disk, and staging
  // used to copy what it pointed at. The upload is refused before anything reads it.
  function makeSymlinkZip(name, target) {
    const dir = fs.mkdtempSync(path.join(tmp, 'sl-'));
    fs.mkdirSync(path.join(dir, 'templates'));
    fs.mkdirSync(path.join(dir, 'class'));
    fs.writeFileSync(path.join(dir, 'layout.json'), MANIFEST());
    fs.writeFileSync(path.join(dir, 'templates/document.tex.njk'), 'x');
    fs.symlinkSync(target, path.join(dir, 'class/innocent.sty'));
    const zipPath = path.join(tmp, name);
    execFileSync('zip', ['-qr', '--symlinks', zipPath, '.'], { cwd: dir });
    return zipPath;
  }

  it.skipIf(!hasZip)('422s a bundle carrying a link, and installs nothing', async () => {
    const secret = path.join(tmp, 'outside-secret.txt');
    fs.writeFileSync(secret, 'SECRET-FILE-CONTENTS');
    const before = db.listLayouts(db.ownerUserId()).length;

    const { status, body } = await uploadZip(makeSymlinkZip('symlink.zip', secret));

    expect(status).toBe(422);
    expect(JSON.stringify(body)).toMatch(/symbolic link/);
    expect(db.listLayouts(db.ownerUserId()).length).toBe(before); // nothing installed
    expect(fs.readFileSync(secret, 'utf8')).toBe('SECRET-FILE-CONTENTS'); // untouched
  });

  it.skipIf(!hasZip)('422s a link pointing at a directory too', async () => {
    const { status, body } = await uploadZip(makeSymlinkZip('symlink-dir.zip', tmp));
    expect(status).toBe(422);
    expect(JSON.stringify(body)).toMatch(/symbolic link/);
  });
});
