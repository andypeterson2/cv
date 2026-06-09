/**
 * Nunjucks render engine for layout bundles.
 *
 * Delimiters are remapped off LaTeX's `{ } %` onto pairs that don't occur in
 * the LaTeX we emit, so template syntax never collides with the document:
 *     <% block %>     << variable >>     <# comment #>
 *
 * Autoescape is OFF (Nunjucks autoescape is HTML-only); templates escape user
 * data explicitly with `| tex`. The verification gate compiles a specials-heavy
 * fixture, so a layout that forgets to escape fails the contract.
 *
 * P0 renders synchronously in-process. Uploaded templates are untrusted code
 * (a runaway loop would block the event loop); P3 swaps the body of
 * renderTemplate() for a worker-thread render with a hard timeout + output cap.
 * The signature stays stable so nothing downstream changes.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const nunjucks = require('nunjucks');
const { registerFilters } = require('./filters');

const TAGS = {
  blockStart: '<%', blockEnd: '%>',
  variableStart: '<<', variableEnd: '>>',
  commentStart: '<#', commentEnd: '#>',
};

/**
 * Build a Nunjucks Environment jailed to a bundle directory. All include/import
 * paths resolve from the bundle root (so the manifest's `templates/...` paths
 * work verbatim). noCache so re-verification always re-reads from disk.
 */
function makeEnv(layoutDir) {
  const loader = new nunjucks.FileSystemLoader(layoutDir, { noCache: true, watch: false });
  const env = new nunjucks.Environment(loader, {
    autoescape: false,
    throwOnUndefined: false,
    // A standalone block tag (\n<% ... %>\n) must not leave a blank line:
    // a blank line is a \par, and LaTeX's non-\long argument macros (e.g.
    // awesome-cv's \cventry) abort with "Paragraph ended before … complete"
    // if a \par lands inside their arguments. trimBlocks+lstripBlocks make
    // own-line control flow whitespace-transparent.
    trimBlocks: true,
    lstripBlocks: true,
    tags: TAGS,
  });
  registerFilters(env);
  return env;
}

/**
 * Render a bundle entry template to a LaTeX string.
 * @param {string} layoutDir  bundle root
 * @param {string} entryRelPath  manifest-relative template path (e.g. templates/document.tex.njk)
 * @param {object} context  the buildContext() output
 * @returns {string}
 */
function renderTemplate(layoutDir, entryRelPath, context) {
  const env = makeEnv(layoutDir);
  // Normalize to forward slashes — Nunjucks loader keys are POSIX-style.
  const key = entryRelPath.split(path.sep).join('/');
  return env.render(key, context);
}

/**
 * Render in a worker thread with a hard timeout + output-size cap. For UNTRUSTED
 * templates (the verification gate): a runaway template is killed by terminate()
 * instead of blocking the event loop. context must be structured-cloneable
 * (buildContext output is plain data). Resolves the rendered string.
 */
function renderInWorker(layoutDir, entryRelPath, context, { timeoutMs = 10000, maxBytes = 5_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'render-worker.js'), {
      workerData: { layoutDir, entryRel: entryRelPath, context },
    });
    let settled = false;
    const done = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); fn(arg); };
    const timer = setTimeout(() => done(reject, new Error(`Template render timed out after ${timeoutMs}ms`)), timeoutMs);
    worker.once('message', (m) => {
      if (!m.ok) return done(reject, new Error(m.error));
      if (typeof m.out === 'string' && m.out.length > maxBytes) return done(reject, new Error(`Rendered output exceeds ${maxBytes} bytes`));
      done(resolve, m.out);
    });
    worker.once('error', (e) => done(reject, e));
  });
}

module.exports = { renderTemplate, renderInWorker, makeEnv, TAGS };
