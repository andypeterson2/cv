/**
 * Render host — the thin orchestrator the compile route calls in place of the
 * legacy generator.generateAll(). Engine- and layout-agnostic:
 *
 *   resolveVariant() output  ──► buildContext()  ──► renderTemplate(layout)
 *   ──► write <kind>.tex + copy bundle class/ (+ assets) into the build dir
 *   ──► return the main .tex path for xelatex
 *
 * A layout owns ALL LaTeX emission via its templates; this file only moves
 * data and files around. Unlike the legacy multi-file (`\input{}`) generator,
 * a template renders the whole document to a single self-contained .tex.
 */
const fs = require('fs');
const path = require('path');
const { buildContext } = require('./context');
const { renderTemplate, renderInWorker } = require('./engine');
const { loadLayout, entryTemplateFor } = require('./loader');

function copyDirFlat(srcDir, destDir) {
  if (!srcDir || !fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(destDir, name));
  }
}

function copyAssets(srcDir, buildDir) {
  if (!srcDir || !fs.existsSync(srcDir)) return;
  const dest = path.join(buildDir, 'assets');
  fs.mkdirSync(dest, { recursive: true });
  copyDirFlat(srcDir, dest);
}

/**
 * Resolve the main output filename from the manifest's `main` template.
 * "{kind}.tex" → "cv.tex" / "resume.tex" / "coverletter.tex".
 */
function mainTexName(manifest, kind) {
  const tmpl = manifest.main || '{kind}.tex';
  return tmpl.replace('{kind}', kind);
}

function prepare(compileData, layoutDir) {
  if (!layoutDir) throw new Error('renderVariant: opts.layoutDir is required');
  const { manifest } = loadLayout(layoutDir);
  const kind = compileData.variant;
  const entryRel = entryTemplateFor(manifest, kind);
  const context = buildContext(compileData, { layoutId: manifest.id });
  return { manifest, kind, entryRel, context };
}

// Write the rendered .tex + stage the layout's class files and assets into the
// build dir, returning the main .tex path for xelatex.
// eslint-disable-next-line max-params -- mirrors the render-callback surface; grandfathered
function finish(buildDir, manifest, kind, tex, layoutDir, assetsDir) {
  fs.mkdirSync(buildDir, { recursive: true });
  copyDirFlat(path.join(layoutDir, 'class'), buildDir); // .cls/.sty/fonts/.fd → root
  copyAssets(path.join(layoutDir, 'assets'), buildDir); // layout-bundled images, then
  copyAssets(assetsDir, buildDir); // project assets (project wins on clash)
  const mainPath = path.join(buildDir, mainTexName(manifest, kind));
  fs.writeFileSync(mainPath, tex.endsWith('\n') ? tex : tex + '\n', 'utf-8');
  return mainPath;
}

/**
 * Render a resolved variant into buildDir using the given layout bundle (sync,
 * in-process). Used for compiling already-installed (verification-passed)
 * layouts — the hot path.
 *
 * @param {object} compileData - db.resolveVariant(id) output
 * @param {string} buildDir - directory to write the compile into
 * @param {object} opts - { layoutDir, assetsDir }
 * @returns {string} absolute path to the main .tex file for xelatex
 */
function renderVariant(compileData, buildDir, opts = {}) {
  const { manifest, kind, entryRel, context } = prepare(compileData, opts.layoutDir);
  const tex = renderTemplate(opts.layoutDir, entryRel, context);
  return finish(buildDir, manifest, kind, tex, opts.layoutDir, opts.assetsDir);
}

/**
 * Same as renderVariant, but renders in a worker thread with a timeout +
 * output cap. Used by the verification gate, where the candidate layout's
 * templates are UNTRUSTED and could loop. Returns a Promise.
 */
async function renderVariantIsolated(compileData, buildDir, opts = {}) {
  const { manifest, kind, entryRel, context } = prepare(compileData, opts.layoutDir);
  const tex = await renderInWorker(opts.layoutDir, entryRel, context, {
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes,
  });
  return finish(buildDir, manifest, kind, tex, opts.layoutDir, opts.assetsDir);
}

module.exports = { renderVariant, renderVariantIsolated, mainTexName };
