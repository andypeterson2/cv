/**
 * Upload + management API (P3). Covers the rejection paths that fail at the
 * static/security gate BEFORE the dynamic xelatex step, so they run without a
 * TeX install. The happy path (which compiles) is covered by the verify unit
 * tests (stubbed compile) + the in-container smoke.
 *
 * Builds real .zip bundles with the `zip` CLI; skips if it isn't available.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');

let hasZip = true;
try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch { hasZip = false; }

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
  if (zipPath) form.append('bundle', new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }), path.basename(zipPath));
  const res = await fetch(`http://localhost:${port}/api/layouts`, { method: 'POST', body: zipPath ? form : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function del(id) {
  return new Promise((resolve) => {
    http.request({ hostname: 'localhost', port, path: `/api/layouts/${id}`, method: 'DELETE' }, (res) => {
      res.on('data', () => {}); res.on('end', () => resolve(res.statusCode));
    }).end();
  });
}

const MANIFEST = (over = {}) => JSON.stringify({
  id: 'cand', name: 'Cand', engine: 'nunjucks', contextVersion: 1,
  kinds: ['cv'], entry: { document: 'templates/document.tex.njk' }, ...over,
});

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  await new Promise((r) => { server = app.listen(0, () => { port = server.address().port; r(); }); });
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
      'templates/document.tex.njk': '\\documentclass{article}\\begin{document}\\write18{id}\\end{document}',
    });
    const { status, body } = await uploadZip(zip);
    expect(status).toBe(422);
    expect(body.error.code).toBe('verification_failed');
    expect(body.error.details.checks.find((c) => c.name === 'security').ok).toBe(false);
  });

  it.skipIf(!hasZip)('422 for an invalid manifest (missing entry)', async () => {
    const bad = JSON.parse(MANIFEST()); delete bad.entry;
    const zip = makeZip('badman.zip', { 'layout.json': JSON.stringify(bad), 'templates/document.tex.njk': 'x' });
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
    expect(layouts.some((l) => l.id === 'awesome-cv')).toBe(true);    // builtins intact
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
