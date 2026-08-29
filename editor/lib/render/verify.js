/**
 * Layout verification — the contract gate. Run on upload and on demand; a
 * candidate bundle must pass before it becomes selectable.
 *
 * Three layers:
 *   1. static    — manifest schema, contextVersion match, declared files exist.
 *   2. security  — scan every .tex/.cls/.sty/.fd/.njk for shell escape and for
 *                  \input/\openin/\openout of absolute or `..` paths. (NOT a
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
const { loadLayout } = require('./loader');
const { renderVariantIsolated } = require('./host');
const { queuedCompile } = require('./latex');
const { CONTEXT_VERSION } = require('./context');
const { makeKitchenSink } = require('./fixtures/kitchen-sink');

const SCANNABLE = /\.(tex|cls|sty|fd|njk)$/i;

// ---------------------------------------------------------------------------
// security scan
// ---------------------------------------------------------------------------

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

function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (SCANNABLE.test(name)) out.push(full);
  }
  return out;
}

function securityScan(bundleDir) {
  const violations = [];
  for (const file of walkFiles(bundleDir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(bundleDir, file);
    for (const v of scanShellEscape(content)) violations.push(`${rel}: ${v}`);
    for (const v of scanPathTraversal(content)) violations.push(`${rel}: path traversal ${v}`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// static checks
// ---------------------------------------------------------------------------

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
    const exists = !!rel && fs.existsSync(path.join(bundleDir, rel));
    checks.push({ name: `entry:${kind}`, ok: exists, detail: exists ? rel : `missing ${rel}` });
  }
  for (const rel of manifest.classFiles || []) {
    const exists = fs.existsSync(path.join(bundleDir, rel));
    checks.push({ name: `classFile:${rel}`, ok: exists, detail: exists ? 'present' : 'missing' });
  }
  return { manifest, checks };
}

// ---------------------------------------------------------------------------
// dynamic checks
// ---------------------------------------------------------------------------

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
  ];
}

function tailLog(log) {
  return (log || '').split('\n').slice(-25).join('\n');
}

async function dynamicCheck(bundleDir, manifest, sample, { compile, assetsDir }) {
  const name = `compile:${sample.label}`;
  if (Array.isArray(manifest.kinds) && !manifest.kinds.includes(sample.data.variant)) {
    return {
      name,
      ok: true,
      detail: `skipped (kind ${sample.data.variant} unsupported)`,
      skipped: true,
    };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  try {
    let mainTex;
    try {
      // Isolated render: the candidate's templates are untrusted (worker + timeout).
      mainTex = await renderVariantIsolated(sample.data, tmp, { layoutDir: bundleDir, assetsDir });
    } catch (e) {
      return { name, ok: false, detail: `render failed: ${e.message}` };
    }
    const result = await compile(tmp, mainTex);
    if (!result.ok) return { name, ok: false, detail: 'xelatex failed', log: tailLog(result.log) };
    if ((result.pages || 0) < 1)
      return { name, ok: false, detail: 'produced 0 pages', log: tailLog(result.log) };
    if (/Undefined control sequence/.test(result.log || '')) {
      return { name, ok: false, detail: 'undefined control sequence', log: tailLog(result.log) };
    }
    return { name, ok: true, detail: `${result.pages} page(s)` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {string} bundleDir
 * @param {object} [opts] - { compile, assetsDir, samples:[{label,data}] }
 *   compile: (buildDir, mainTex) => Promise<{ok,pages,log}>  (default: real xelatex)
 *   samples: extra real-data resolved variants to smoke-compile
 * @returns {Promise<{ok, layoutId, checks}>}
 */
async function verifyLayout(bundleDir, opts = {}) {
  const { compile = queuedCompile, assetsDir = null, samples = [] } = opts;
  const checks = [];

  const sec = securityScan(bundleDir);
  checks.push({
    name: 'security',
    ok: sec.length === 0,
    detail: sec.length ? sec.join('; ') : 'clean',
  });

  const st = staticChecks(bundleDir);
  checks.push(...st.checks);

  if (checks.every((c) => c.ok) && st.manifest) {
    for (const sample of [...fixtureSamples(), ...samples]) {
      checks.push(await dynamicCheck(bundleDir, st.manifest, sample, { compile, assetsDir }));
    }
  } else {
    checks.push({ name: 'compile', ok: false, detail: 'skipped — static/security checks failed' });
  }

  return { ok: checks.every((c) => c.ok), layoutId: st.manifest && st.manifest.id, checks };
}

/**
 * Build real-data smoke samples from the DB: up to maxSamples resolved
 * variants (one per kind per person). Passed to verifyLayout so a candidate is
 * tested against the shapes the user's actual data produces, not just fixtures.
 */
function gatherSamples(db, { maxSamples = 6 } = {}) {
  const samples = [];
  try {
    for (const person of db.getPersons()) {
      const seenKinds = new Set();
      for (const v of db.getVariants(person.id)) {
        if (seenKinds.has(v.kind)) continue;
        seenKinds.add(v.kind);
        try {
          samples.push({ label: `real:${person.id}:${v.kind}`, data: db.resolveVariant(v.id) });
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

module.exports = { verifyLayout, securityScan, staticChecks, fixtureSamples, gatherSamples };
