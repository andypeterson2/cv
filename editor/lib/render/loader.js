/**
 * Load + structurally validate a layout bundle from disk.
 *
 * A bundle is a directory containing layout.json (manifest), templates/, and
 * class/ (the .cls/.sty/fonts copied into each compile). Deep manifest
 * validation + the security scan live in ./verify.js (P2); this module just
 * reads the manifest, sanity-checks the load-bearing fields, and provides
 * bundle-jailed path resolution so a manifest can never point outside its own
 * directory.
 */
const fs = require('fs');
const path = require('path');

class LayoutError extends Error {}

/**
 * Resolve a manifest-relative path and guarantee it stays inside the bundle.
 * Rejects absolute paths, `..` escapes, and symlinks that resolve outside.
 */
function resolveInBundle(layoutDir, relPath) {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new LayoutError(`Invalid bundle path: ${JSON.stringify(relPath)}`);
  }
  if (path.isAbsolute(relPath)) {
    throw new LayoutError(`Absolute paths not allowed in a bundle: ${relPath}`);
  }
  const root = fs.realpathSync(layoutDir);
  const abs = path.resolve(root, relPath);
  // realpath the existing prefix so a symlink can't tunnel out.
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* file may not exist yet — check the lexical path */
  }
  const rel = path.relative(root, real);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new LayoutError(`Bundle path escapes its directory: ${relPath}`);
  }
  return abs;
}

/**
 * Read + parse a bundle's manifest and run cheap structural checks.
 * @returns {{ dir: string, manifest: object }}
 */
function loadLayout(layoutDir) {
  if (!fs.existsSync(layoutDir) || !fs.statSync(layoutDir).isDirectory()) {
    throw new LayoutError(`Layout bundle not found: ${layoutDir}`);
  }
  const manifestPath = path.join(layoutDir, 'layout.json');
  if (!fs.existsSync(manifestPath)) {
    throw new LayoutError(`Bundle is missing layout.json: ${layoutDir}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    throw new LayoutError(`Bundle layout.json is not valid JSON: ${e.message}`);
  }
  for (const field of ['id', 'engine', 'kinds', 'entry']) {
    if (manifest[field] == null) throw new LayoutError(`Manifest missing required field: ${field}`);
  }
  if (!Array.isArray(manifest.kinds) || manifest.kinds.length === 0) {
    throw new LayoutError('Manifest "kinds" must be a non-empty array');
  }
  return { dir: layoutDir, manifest };
}

/**
 * Resolve the entry template for a document kind.
 * Cover letters use entry.coverletter; cv/resume share entry.document.
 */
function entryTemplateFor(manifest, kind) {
  const entry = manifest.entry || {};
  const rel = kind === 'coverletter' ? entry.coverletter : entry.document;
  if (!rel) throw new LayoutError(`Layout "${manifest.id}" does not support kind "${kind}"`);
  return rel;
}

module.exports = { loadLayout, resolveInBundle, entryTemplateFor, LayoutError };
