/**
 * readBundle is the gate every layout zip passes (GitHub zipballs included) before
 * anything reads its files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');
const { readBundle } = require('../../lib/render/bundle');

let hasZip = true;
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  hasZip = false;
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

let tmp;
let db;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'));
  db = new CvDatabase(':memory:');
  seedBuiltinLayouts(db);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeZip(name, files, { link } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'z-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  if (link) {
    fs.mkdirSync(path.join(dir, 'class'), { recursive: true });
    fs.symlinkSync(link, path.join(dir, 'class/innocent.sty'));
  }
  const zipPath = path.join(tmp, name);
  execFileSync('zip', ['-qr', '--symlinks', zipPath, '.'], { cwd: dir });
  return zipPath;
}

const bundle = (over) => ({ 'layout.json': MANIFEST(over), 'templates/document.tex.njk': 'x' });

describe.skipIf(!hasZip)('readBundle', () => {
  test('reads a valid bundle', async () => {
    const { work, manifest } = await readBundle(makeZip('ok.zip', bundle()), db);
    expect(manifest.id).toBe('cand');
    fs.rmSync(work, { recursive: true, force: true });
  });

  test('refuses a zip without layout.json, a bad manifest, or a non-slug id', async () => {
    await expect(readBundle(makeZip('n.zip', { 'readme.txt': 'hi' }), db)).rejects.toMatchObject({
      status: 422,
    });
    const bad = JSON.parse(MANIFEST());
    delete bad.entry;
    await expect(
      readBundle(makeZip('b.zip', { 'layout.json': JSON.stringify(bad) }), db),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      readBundle(makeZip('e.zip', bundle({ id: '../escape' })), db),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a builtin's id", async () => {
    await expect(
      readBundle(makeZip('c.zip', bundle({ id: 'awesome-cv' })), db),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('refuses a bundle carrying a symbolic link, to a file or a directory', async () => {
    const secret = path.join(tmp, 'outside-secret.txt');
    fs.writeFileSync(secret, 'SECRET');
    await expect(readBundle(makeZip('s.zip', bundle(), { link: secret }), db)).rejects.toThrow(
      /symbolic link/,
    );
    await expect(readBundle(makeZip('d.zip', bundle(), { link: tmp }), db)).rejects.toThrow(
      /symbolic link/,
    );
    expect(fs.readFileSync(secret, 'utf8')).toBe('SECRET');
  });

  test('a folder must exist inside the single top-level directory and stay in it', async () => {
    const zip = makeZip('gh.zip', {
      'repo-abc/layouts/modern/layout.json': MANIFEST(),
      'repo-abc/layouts/modern/templates/document.tex.njk': 'x',
    });
    const { work, manifest } = await readBundle(zip, db, { subdir: 'layouts/modern' });
    expect(manifest.id).toBe('cand');
    fs.rmSync(work, { recursive: true, force: true });
    await expect(readBundle(zip, db, { subdir: 'layouts/missing' })).rejects.toThrow(
      /No layout.json/,
    );
    await expect(readBundle(zip, db, { subdir: '../../etc' })).rejects.toMatchObject({
      status: 400,
    });
  });
});
