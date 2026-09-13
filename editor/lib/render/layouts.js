/**
 * Layout bundle location resolver: read-only builtin bundles baked next to the
 * app, plus a writable store (CV_LAYOUTS_DIR) for uploaded bundles.
 */
const path = require('path');

// Read-only builtin bundles, shipped inside the image with the editor source.
const BUILTIN_LAYOUTS_DIR = path.join(__dirname, '..', '..', 'layouts');

// Writable store for uploaded bundles. Deploy sets CV_LAYOUTS_DIR=/data/layouts
// (under the cv_data volume). Dev default sits next to the package.
const CV_LAYOUTS_DIR =
  process.env.CV_LAYOUTS_DIR || path.join(__dirname, '..', '..', '..', 'layouts-store');

const DEFAULT_LAYOUT_ID = 'awesome-cv';

function builtinLayoutDir(id = DEFAULT_LAYOUT_ID) {
  return path.join(BUILTIN_LAYOUTS_DIR, id);
}

function uploadedLayoutDir(id) {
  return path.join(CV_LAYOUTS_DIR, id);
}

/** On-disk bundle directory for a layout DB row (builtin vs uploaded). */
function layoutDirForRow(row) {
  return row && row.source === 'builtin' ? builtinLayoutDir(row.id) : uploadedLayoutDir(row.id);
}

module.exports = {
  BUILTIN_LAYOUTS_DIR,
  CV_LAYOUTS_DIR,
  DEFAULT_LAYOUT_ID,
  builtinLayoutDir,
  uploadedLayoutDir,
  layoutDirForRow,
};
