/**
 * Verification / contract harness. The dynamic xelatex step is injected as a
 * stub so static + security + orchestration are tested without a TeX install;
 * real-compile coverage runs in the container / upload path.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyLayout, securityScan, gatherSamples } = require('../../lib/render/verify');
const { renderVariantIsolated } = require('../../lib/render/host');
const { makeKitchenSink } = require('../../lib/render/fixtures/kitchen-sink');
const { getLatexType, LATEX_TYPE_MAP } = require('../../lib/latex-type-map');

const BUILTIN = path.join(__dirname, '..', '..', 'layouts', 'awesome-cv');
const okCompile = async () => ({
  ok: true,
  pages: 2,
  log: 'Output written on x.pdf (2 pages, 1 bytes)',
});

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeBundle(files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'bundle-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const MINIMAL_MANIFEST = {
  id: 'test-layout',
  name: 'Test',
  engine: 'nunjucks',
  contextVersion: 1,
  kinds: ['cv'],
  entry: { document: 'templates/document.tex.njk' },
};

describe('builtin awesome-cv passes the gate', () => {
  it('passes static + security + (stubbed) dynamic', async () => {
    const report = await verifyLayout(BUILTIN, { compile: okCompile });
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.layoutId).toBe('awesome-cv');
    // the real render ran for each fixture kind (only xelatex was stubbed)
    expect(report.checks.some((c) => c.name === 'compile:fixture:coverletter' && c.ok)).toBe(true);
  });
});

describe('security scan', () => {
  it('flags \\write18 and absolute/.. path file ops', () => {
    const v = securityScan(
      writeBundle({
        'layout.json': JSON.stringify(MINIMAL_MANIFEST),
        'templates/document.tex.njk':
          '\\write18{rm -rf /}\n\\input{/etc/passwd}\n\\openin1=../../secret\n',
      }),
    );
    expect(v.join('\n')).toMatch(/write18/);
    expect(v.join('\n')).toMatch(/\/etc\/passwd/);
    expect(v.join('\n')).toMatch(/secret/);
  });

  it('does not flag legitimate relative file ops or \\directlua', () => {
    const v = securityScan(
      writeBundle({
        'class/x.sty':
          '\\openin\\@mainaux\n\\immediate\\write\\@auxout{}\n\\directlua{require("foo")}\n\\input{sub/part.tex}\n',
      }),
    );
    expect(v).toEqual([]);
  });

  it('rejects a bundle with a shell escape end to end', async () => {
    const dir = writeBundle({
      'layout.json': JSON.stringify(MINIMAL_MANIFEST),
      'templates/document.tex.njk':
        '\\documentclass{article}\\begin{document}\\write18{id}\\end{document}',
    });
    const report = await verifyLayout(dir, { compile: okCompile });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'security').ok).toBe(false);
    // dynamic compile must be skipped once security fails
    expect(report.checks.some((c) => c.name === 'compile' && /skipped/.test(c.detail))).toBe(true);
  });
});

describe('static checks', () => {
  it('fails an invalid manifest (missing entry)', async () => {
    const bad = { ...MINIMAL_MANIFEST };
    delete bad.entry;
    const dir = writeBundle({
      'layout.json': JSON.stringify(bad),
      'templates/document.tex.njk': 'x',
    });
    const report = await verifyLayout(dir, { compile: okCompile });
    expect(report.ok).toBe(false);
  });

  it('fails a contextVersion the host does not support', async () => {
    const dir = writeBundle({
      'layout.json': JSON.stringify({ ...MINIMAL_MANIFEST, contextVersion: 99 }),
      'templates/document.tex.njk': 'x',
    });
    const report = await verifyLayout(dir, { compile: okCompile });
    expect(report.checks.find((c) => c.name === 'manifest:contextVersion').ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('fails when a declared entry template is missing', async () => {
    const dir = writeBundle({ 'layout.json': JSON.stringify(MINIMAL_MANIFEST) }); // no template file
    const report = await verifyLayout(dir, { compile: okCompile });
    expect(report.checks.find((c) => c.name === 'entry:document').ok).toBe(false);
    expect(report.ok).toBe(false);
  });
});

describe('dynamic check', () => {
  it('fails when xelatex fails', async () => {
    const report = await verifyLayout(BUILTIN, {
      compile: async () => ({ ok: false, pages: 0, log: '! something' }),
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name.startsWith('compile:fixture') && !c.ok)).toBe(true);
  });

  it('fails on 0 pages or undefined control sequence', async () => {
    const r0 = await verifyLayout(BUILTIN, {
      compile: async () => ({ ok: true, pages: 0, log: '' }),
    });
    expect(r0.ok).toBe(false);
    const rU = await verifyLayout(BUILTIN, {
      compile: async () => ({ ok: true, pages: 1, log: '! Undefined control sequence' }),
    });
    expect(rU.ok).toBe(false);
  });
});

describe('untrusted-render isolation', () => {
  it('kills a runaway template via the worker timeout', async () => {
    const dir = writeBundle({
      'layout.json': JSON.stringify({ ...MINIMAL_MANIFEST, id: 'spin' }),
      // nested loops → ~1e10 iterations, tiny memory: spins past the timeout
      'templates/document.tex.njk':
        '<% for i in range(100000) %><% for j in range(100000) %><% endfor %><% endfor %>done',
    });
    const buildDir = fs.mkdtempSync(path.join(tmp, 'b-'));
    await expect(
      renderVariantIsolated(makeKitchenSink({ variant: 'cv' }), buildDir, {
        layoutDir: dir,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/timed out/);
  }, 10000);
});

describe('fixture coverage guard', () => {
  it('the kitchen-sink cv covers every LaTeX type the data model can produce', () => {
    const fixture = makeKitchenSink({ variant: 'cv' });
    const covered = new Set(fixture.sections.map((s) => getLatexType(s.type)));
    const required = new Set(Object.values(LATEX_TYPE_MAP));
    for (const t of required) expect(covered.has(t)).toBe(true);
  });
});

describe('gatherSamples scoping', () => {
  const CvDatabase = require('../../lib/db');

  it('returns only the named account’s own résumés', () => {
    const db = new CvDatabase(':memory:');
    const a = db.upsertUser({ googleSub: 'g-a', email: 'a@x.test' });
    const b = db.upsertUser({ googleSub: 'g-b', email: 'b@x.test' });
    const pa = db.createPerson('A person', a);
    const pb = db.createPerson('B person', b);
    db.createSection(pa, 'exp', 'experience', 'Experience');
    db.createSection(pb, 'exp', 'experience', 'Experience');
    db.createVariant(pa, 'VA', 'cv');
    db.createVariant(pb, 'VB', 'cv');

    const labels = (uid) => gatherSamples(db, { userId: uid }).map((s) => s.label);
    expect(labels(a)).toEqual([`real:${pa}:cv`]);
    expect(labels(b)).toEqual([`real:${pb}:cv`]);
    // A report handed to one account must not name another account's person.
    expect(labels(a).join()).not.toContain(String(pb));
    db.close();
  });

  it('yields nothing when no account is named', () => {
    const db = new CvDatabase(':memory:');
    db.createPerson('Someone', db.ownerUserId());
    expect(gatherSamples(db)).toEqual([]);
    db.close();
  });
});

describe('bundle path confinement', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadLayout, entryTemplateFor } = require('../../lib/render/loader');

  let root;
  let dir;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jail-'));
    fs.writeFileSync(path.join(root, 'outside.njk'), 'x');
    dir = path.join(root, 'bundle');
    fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const manifest = (over) =>
    fs.writeFileSync(
      path.join(dir, 'layout.json'),
      JSON.stringify({
        id: 'jail',
        name: 'Jail',
        engine: 'nunjucks',
        contextVersion: 1,
        kinds: ['cv'],
        entry: { document: 'templates/document.tex.njk' },
        ...over,
      }),
    );

  it('fails a manifest whose entry points outside the bundle', async () => {
    manifest({ entry: { document: '../outside.njk' } });
    const report = await verifyLayout(dir, { compile: async () => ({ ok: true, pages: 1 }) });
    const check = report.checks.find((c) => c.name === 'entry:document');
    expect(report.ok).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/escapes its directory/);
  });

  it('fails a classFile that points outside the bundle', async () => {
    fs.writeFileSync(path.join(dir, 'templates/document.tex.njk'), 'x');
    manifest({ classFiles: ['../outside.njk'] });
    const report = await verifyLayout(dir, { compile: async () => ({ ok: true, pages: 1 }) });
    expect(report.checks.find((c) => c.name === 'classFile:../outside.njk').ok).toBe(false);
  });

  it('refuses an escaping entry at render time too', () => {
    manifest({ entry: { document: '../outside.njk' } });
    const { manifest: m } = loadLayout(dir);
    expect(() => entryTemplateFor(m, 'cv', dir)).toThrow(/escapes its directory/);
  });

  it('rejects a manifest id that is not a slug', () => {
    manifest({ id: '../escape' });
    expect(() => loadLayout(dir)).toThrow(/Manifest id must match/);
  });

  it('accepts a namespaced upload id', () => {
    manifest({ id: 'u7-modern' });
    expect(loadLayout(dir).manifest.id).toBe('u7-modern');
  });
});
