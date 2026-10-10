/**
 * Layout verification — the contract gate. Run on upload and on demand; a
 * candidate bundle must pass before it becomes selectable.
 *
 * Three layers:
 *   1. static    — manifest schema, contextVersion match, declared files exist.
 *   2. security  — scan every .tex/.cls/.sty/.fd/.njk for shell escape and for
 *                  \input/\openin/\openout of absolute or `..` paths. (not a
 *                  blanket \directlua/\write reject — those have legitimate uses,
 *                  e.g. the bundled FontAwesome helper, and are inert/bounded
 *                  under xelatex --no-shell-escape.)
 *   3. dynamic   — render the kitchen-sink fixture (every section type, socials,
 *                  specials, cover letter) AND any real-data samples, compile
 *                  each with xelatex, and require exit 0 + a PDF + pages >= 1 +
 *                  no "Undefined control sequence".
 *
 * Returns a structured report { ok, layoutId, checks:[{name,ok,detail[,log]}] }.
 * The xelatex runner is injectable (opts.compile) so the static + security +
 * orchestration layers are testable without a TeX install.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateManifest } = require('./manifest-schema');
const { loadLayout, resolveInBundle } = require('./loader');
const { renderVariantIsolated } = require('./host');
const { queuedCompile } = require('./latex');
const { CONTEXT_VERSION } = require('./context');
const { makeKitchenSink } = require('./fixtures/kitchen-sink');
const { buildContext } = require('./context');
const { extractText, checkText } = require('./text-check');
const { scanPdf } = require('./pdf-scan');
const { SYMBOLS } = require('../symbols');

const SCANNABLE = /\.(tex|cls|sty|fd|njk)$/i;

// security scan

function scanShellEscape(content) {
  return /\\write\s*18(?![0-9])/.test(content) ? ['\\write18 (shell escape)'] : [];
}

// Flag \input/\openin/... whose path argument is absolute (/...) or climbs (..).
// Relative reads (\input{sub/part.tex}, \openin\@mainaux) are fine and not
// matched. The negative lookahead allows an attached stream number (\openin1=…)
// while not matching longer commands (\inputencoding); the argument is read on
// the same line only so a later command's brace can't be misattributed.
function scanPathTraversal(content) {
  const hits = [];
  const re = /\\(input|include|openin|openout|openread|openwrite)(?![a-zA-Z])/g;
  let m;
  while ((m = re.exec(content))) {
    const sameLine = content.slice(m.index).split('\n', 1)[0].slice(0, 120);
    const pm = /(?:\{|=)\s*([^\s{}=,;%]+)/.exec(sameLine);
    if (pm && (pm[1].startsWith('/') || pm[1].includes('..'))) hits.push(`${m[1]}{${pm[1]}}`);
  }
  return hits;
}

// lstat so a link is neither followed nor scanned; staging ignores links too.
function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (st.isFile() && SCANNABLE.test(name)) out.push(full);
  }
  return out;
}

function securityScan(bundleDir) {
  const violations = [];
  // Nothing to scan when the bundle directory is gone; staticChecks reports that.
  if (!fs.existsSync(bundleDir)) return violations;
  for (const file of walkFiles(bundleDir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(bundleDir, file);
    for (const v of scanShellEscape(content)) violations.push(`${rel}: ${v}`);
    for (const v of scanPathTraversal(content)) violations.push(`${rel}: path traversal ${v}`);
  }
  return violations;
}

// Raw-PDF commands a reviewer should look at before a layout goes public. They are
// not rejected outright: a layout may legitimately use \special for marked content.
const REVIEW_PATTERNS = [
  [
    /pdf:\s*(fstream|ann|bann|obj|put|stream|docview|outline|dest)\b/,
    'raw PDF object via \\special',
  ],
  [/\\pdf(annot|catalog|obj|literal|names)(?![a-zA-Z])/, 'pdfTeX object primitive'],
];

function reviewWarnings(bundleDir) {
  const warnings = [];
  if (!fs.existsSync(bundleDir)) return warnings;
  for (const file of walkFiles(bundleDir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(bundleDir, file);
    for (const [re, what] of REVIEW_PATTERNS) {
      const m = re.exec(content);
      if (m) warnings.push(`${rel}: ${what} (${m[0]})`);
    }
  }
  return warnings;
}

// static checks

/**
 * A path the manifest declares: it has to stay inside the bundle and it has to be
 * there. Resolving it through the bundle jail means a manifest reaching outside its
 * own directory fails verification rather than being reported as present.
 */
function declaredFile(bundleDir, rel) {
  let abs;
  try {
    abs = resolveInBundle(bundleDir, rel);
  } catch (e) {
    return { ok: false, detail: e.message };
  }
  const exists = fs.existsSync(abs);
  return { ok: exists, detail: exists ? rel : `missing ${rel}` };
}

/**
 * Every file in class/ has to be named in classFiles, because classFiles is what
 * ships. An undeclared file would sit in the bundle and never reach a compile, so
 * the bundle is refused rather than installed in a state that loses it quietly.
 */
function classDirDeclared(bundleDir, manifest) {
  const dir = path.join(bundleDir, 'class');
  if (!fs.existsSync(dir)) return { ok: true, detail: 'no class/ directory' };
  const declared = new Set((manifest.classFiles || []).map((r) => path.basename(r)));
  const undeclared = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.isDirectory() && !declared.has(e.name))
    .map((e) => e.name);
  return undeclared.length === 0
    ? { ok: true, detail: `${declared.size} declared` }
    : {
        ok: false,
        detail: `class/ holds files classFiles does not name: ${undeclared.join(', ')}`,
      };
}

function staticChecks(bundleDir) {
  let manifest;
  try {
    ({ manifest } = loadLayout(bundleDir));
  } catch (e) {
    return { manifest: null, checks: [{ name: 'manifest:load', ok: false, detail: e.message }] };
  }

  const checks = [];
  const mv = validateManifest(manifest);
  checks.push({
    name: 'manifest:schema',
    ok: mv.ok,
    detail: mv.ok ? 'valid' : mv.errors.join('; '),
  });

  const cvOk = manifest.contextVersion == null || manifest.contextVersion === CONTEXT_VERSION;
  checks.push({
    name: 'manifest:contextVersion',
    ok: cvOk,
    detail: cvOk
      ? `v${manifest.contextVersion ?? '(unset)'}`
      : `bundle wants v${manifest.contextVersion}, host is v${CONTEXT_VERSION}`,
  });

  for (const [kind, rel] of Object.entries(manifest.entry || {})) {
    checks.push({ name: `entry:${kind}`, ...declaredFile(bundleDir, rel) });
  }
  for (const rel of manifest.classFiles || []) {
    checks.push({ name: `classFile:${rel}`, ...declaredFile(bundleDir, rel) });
  }
  checks.push({ name: 'classFiles:complete', ...classDirDeclared(bundleDir, manifest) });
  return { manifest, checks };
}

// dynamic checks

// Kitchen sink plus short bullets that between them hold every palette symbol.
function symbolSink() {
  const data = makeKitchenSink({ variant: 'cv' });
  const glyphs = [...new Set(SYMBOLS.map((x) => x.glyph))];
  for (let i = 0; i < glyphs.length; i += 8) {
    const row = glyphs.slice(i, i + 8).join(' ');
    data.sections[0].entries[0].items.push({ content: `Symbol row ${i / 8 + 1}: ${row}` });
  }
  return data;
}

function fixtureSamples() {
  return [
    { label: 'fixture:cv', data: makeKitchenSink({ variant: 'cv' }) },
    { label: 'fixture:resume', data: makeKitchenSink({ variant: 'resume' }) },
    { label: 'fixture:coverletter', data: makeKitchenSink({ variant: 'coverletter' }) },
    {
      label: 'fixture:roboto-customhex',
      data: makeKitchenSink({
        variant: 'cv',
        style: { fontFamily: 'roboto', accentColor: 'custom', customHex: '#3366CC' },
      }),
    },
    { label: 'fixture:symbols', data: symbolSink() },
    {
      label: 'fixture:symbols-roboto',
      data: Object.assign(symbolSink(), { style: { fontFamily: 'roboto' } }),
    },
  ].map((sample) => ({ ...sample, textCheck: true }));
}

function tailLog(log) {
  return (log || '').split('\n').slice(-25).join('\n');
}

/**
 * Compare the PDF's extractable text with the sample's source text, and flag
 * characters the font could not draw (they would print as nothing).
 */
async function textCheck(sample, result, extract) {
  const name = `text:${sample.label}`;
  const text = result.pdfPath ? await extract(result.pdfPath) : null;
  if (text == null) return { name, ok: true, detail: 'skipped (no pdftotext)', skipped: true };
  const ctx = buildContext(sample.data);
  const { issues } = checkText(ctx, text);
  for (const m of new Set((result.log || '').match(/Missing character: There is no \S+/g) || [])) {
    issues.unshift({ rule: 'missing-glyph', sample: m.split(' ').pop() });
  }
  if (issues.length === 0) return { name, ok: true, detail: 'extracted text matches source' };
  return {
    name,
    ok: false,
    detail: issues
      .slice(0, 12)
      .map((i) => `${i.rule}: ${i.sample}`)
      .join('; '),
  };
}

/** Look inside the compiled PDF for scripts, auto-run actions and embedded files. */
async function pdfCheck(sample, result, scan) {
  const name = `pdf:${sample.label}`;
  let found;
  try {
    found = result.pdfPath ? await scan(result.pdfPath) : null;
  } catch (e) {
    return { name, ok: false, detail: `could not read the PDF: ${e.message.split('\n')[0]}` };
  }
  if (found == null) return { name, ok: true, detail: 'skipped (no qpdf)', skipped: true };
  if (found.forbidden.length === 0) return { name, ok: true, detail: 'no active content' };
  return { name, ok: false, detail: `active content: ${found.forbidden.join(', ')}` };
}

async function dynamicCheck(
  bundleDir,
  manifest,
  sample,
  { compile, assetsDir, extract, scan, compileKey },
) {
  const name = `compile:${sample.label}`;
  if (Array.isArray(manifest.kinds) && !manifest.kinds.includes(sample.data.variant)) {
    return [
      {
        name,
        ok: true,
        detail: `skipped (kind ${sample.data.variant} unsupported)`,
        skipped: true,
      },
    ];
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  try {
    let mainTex;
    try {
      // Isolated render: the candidate's templates are untrusted (worker + timeout).
      mainTex = await renderVariantIsolated(sample.data, tmp, { layoutDir: bundleDir, assetsDir });
    } catch (e) {
      return [{ name, ok: false, detail: `render failed: ${e.message}` }];
    }
    const result = await compile(tmp, mainTex, { key: compileKey });
    if (!result.ok)
      return [{ name, ok: false, detail: 'xelatex failed', log: tailLog(result.log) }];
    if ((result.pages || 0) < 1)
      return [{ name, ok: false, detail: 'produced 0 pages', log: tailLog(result.log) }];
    if (/Undefined control sequence/.test(result.log || '')) {
      return [{ name, ok: false, detail: 'undefined control sequence', log: tailLog(result.log) }];
    }
    const checks = [{ name, ok: true, detail: `${result.pages} page(s)`, ms: result.ms }];
    if (sample.textCheck) {
      checks.push(await textCheck(sample, result, extract));
      checks.push(await pdfCheck(sample, result, scan));
    }
    return checks;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// orchestrator

/**
 * @param {string} bundleDir
 * @param {object} [opts] - { compile, extractText, scanPdf, assetsDir, samples, compileKey }
 *   compile: (buildDir, mainTex, {key}) => Promise<{ok,pages,log,pdfPath,ms}>  (default: real xelatex)
 *   extractText: (pdfPath) => Promise<string|null>  (default: pdftotext; null = skipped)
 *   scanPdf: (pdfPath) => Promise<{forbidden}|null>  (default: qpdf; null = skipped)
 *   compileKey: the account the compiles count against (per-account compile cap)
 *   fixtures: false to compile only `samples` (a pin-time check against someone's data)
 *   samples: extra real-data resolved variants to smoke-compile
 * @returns {Promise<{ok, layoutId, checks}>}
 */
async function verifyLayout(bundleDir, opts = {}) {
  const { compile = queuedCompile, assetsDir = null, samples = [] } = opts;
  const extract = opts.extractText || extractText;
  const scan = opts.scanPdf || scanPdf;
  const { compileKey = null, fixtures = true } = opts;
  const checks = [];

  const sec = securityScan(bundleDir);
  checks.push({
    name: 'security',
    ok: sec.length === 0,
    detail: sec.length ? sec.join('; ') : 'clean',
  });

  const warnings = reviewWarnings(bundleDir);
  checks.push({
    name: 'security:review',
    ok: true,
    detail: warnings.length ? warnings.join('; ') : 'nothing to review',
    warnings,
  });

  const st = staticChecks(bundleDir);
  checks.push(...st.checks);

  if (checks.every((c) => c.ok) && st.manifest) {
    for (const sample of [...(fixtures ? fixtureSamples() : []), ...samples]) {
      checks.push(
        ...(await dynamicCheck(bundleDir, st.manifest, sample, {
          compile,
          assetsDir,
          extract,
          scan,
          compileKey,
        })),
      );
    }
  } else {
    checks.push({ name: 'compile', ok: false, detail: 'skipped — static/security checks failed' });
  }

  return { ok: checks.every((c) => c.ok), layoutId: st.manifest && st.manifest.id, checks };
}

/**
 * Build real-data smoke samples from a single account's own résumés: up to maxSamples
 * resolved variants (one per kind per profile of theirs). Passed to verifyLayout so a
 * candidate is tested against the shapes that account's data produces as well as
 * fixtures.
 *
 * Scoped to `userId` because a candidate bundle's templates are untrusted and run over
 * whatever is passed here, and the report — profile ids, and the xelatex log on failure
 * — goes back to whoever uploaded it. Without a userId there are no samples.
 */
function gatherSamples(db, { userId = null, maxSamples = 6 } = {}) {
  const samples = [];
  if (userId == null) return samples;
  try {
    for (const profile of db.getProfilesForUser(userId)) {
      const seenKinds = new Set();
      for (const v of db.getVariants(profile.id)) {
        if (seenKinds.has(v.kind)) continue;
        seenKinds.add(v.kind);
        try {
          samples.push({ label: `real:${profile.id}:${v.kind}`, data: db.resolveVariant(v.id) });
        } catch {
          /* skip unresolvable variant */
        }
        if (samples.length >= maxSamples) return samples;
      }
    }
  } catch {
    /* empty / unavailable db */
  }
  return samples;
}

/**
 * The part of a report anyone may see: real-data samples quote the verifying
 * account's résumé, so only fixture checks are kept.
 */
function publicReport(report) {
  if (!report || !Array.isArray(report.checks)) return report;
  const checks = report.checks.filter((c) => !String(c.name).includes(':real:'));
  return { ...report, checks };
}

/** The slowest fixture compile in a report, in ms, or null when none ran. */
function slowestCompile(report) {
  const times = (report?.checks || []).filter((c) => typeof c.ms === 'number').map((c) => c.ms);
  return times.length ? Math.max(...times) : null;
}

const KIND_OF_FIXTURE = { cv: 'cv', resume: 'resume', coverletter: 'coverletter' };

/** One plain sentence per failed check, for someone fixing a bundle before upload. */
function describeCheck(c) {
  const where = c.name.slice(c.name.indexOf(':') + 1);
  if (c.name === 'security') return `Not allowed: ${c.detail}`;
  if (c.name.startsWith('manifest:')) return `layout.json: ${c.detail}`;
  if (c.name.startsWith('entry:')) return `No template for ${c.name.slice(6)}: ${c.detail}`;
  if (c.name.startsWith('classFile') || c.name === 'classFiles:complete')
    return `Class files: ${c.detail}`;
  if (c.name === 'compile') return `Not compiled: ${c.detail}`;
  if (c.name.startsWith('compile:')) {
    const first = (c.log || '').split('\n').find((l) => l.startsWith('!'));
    return `${where} does not compile: ${c.detail}${first ? ` (${first.slice(2)})` : ''}`;
  }
  if (c.name.startsWith('text:')) return `${where} extracts wrongly: ${c.detail}`;
  if (c.name.startsWith('pdf:')) return `${where} PDF has ${c.detail}`;
  return `${c.name}: ${c.detail}`;
}

/**
 * What a bundle is missing or gets wrong, in plain sentences: kinds it does not
 * handle, failed checks, and review notes on raw PDF commands.
 */
function summarizeReport(report, manifest) {
  const missing = [];
  const kinds = Array.isArray(manifest?.kinds) ? manifest.kinds : [];
  for (const kind of Object.keys(KIND_OF_FIXTURE)) {
    if (manifest && !kinds.includes(kind))
      missing.push(`Does not declare the ${kind} kind, so ${kind} documents use another layout`);
  }
  for (const c of report?.checks || []) missing.push(...checkLines(c));
  return [...new Set(missing)];
}

function checkLines(c) {
  if (c.name === 'security:review')
    return (c.warnings || []).map((w) => `Needs review before sharing: ${w}`);
  if (c.skipped && /no (qpdf|pdftotext)/.test(c.detail || ''))
    return [`${c.name} was not checked on this server (${c.detail})`];
  return !c.ok && !c.skipped ? [describeCheck(c)] : [];
}

module.exports = {
  verifyLayout,
  securityScan,
  gatherSamples,
  publicReport,
  slowestCompile,
  summarizeReport,
};
