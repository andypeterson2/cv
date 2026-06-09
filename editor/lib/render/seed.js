/**
 * Boot seed: register the builtin layout bundles (editor/layouts/<id>) as DB
 * rows so they're listable, selectable, and FK-referenceable, and set the
 * global default if none is set. Idempotent — safe to run on every startup.
 *
 * Builtin bundle FILES stay read-only under BUILTIN_LAYOUTS_DIR; only metadata
 * is written to the DB. (Uploaded bundles, P3, live under CV_LAYOUTS_DIR.)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BUILTIN_LAYOUTS_DIR, DEFAULT_LAYOUT_ID, uploadedLayoutDir } = require('./layouts');
const { loadLayout } = require('./loader');

/** Stable hash of a bundle's manifest + template sources, for drift detection. */
function bundleChecksum(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(njk|json)$/.test(name)) { h.update(name); h.update(fs.readFileSync(full)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function seedBuiltinLayouts(db) {
  if (!fs.existsSync(BUILTIN_LAYOUTS_DIR)) return;
  for (const id of fs.readdirSync(BUILTIN_LAYOUTS_DIR)) {
    const dir = path.join(BUILTIN_LAYOUTS_DIR, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    let manifest;
    try { ({ manifest } = loadLayout(dir)); } catch { continue; }
    db.upsertLayout({
      id: manifest.id,
      name: manifest.name || manifest.id,
      version: manifest.version,
      engine: manifest.engine,
      kinds: manifest.kinds,
      status: 'active',
      source: 'builtin',
      manifest,
      checksum: bundleChecksum(dir),
      report: null,
      verified_at: null,
    });
  }
  // Reconcile DB/disk drift: drop uploaded rows whose bundle dir vanished
  // (e.g. the layouts volume was reset but the DB persisted).
  for (const l of db.listLayouts()) {
    if (l.source !== 'builtin' && !fs.existsSync(uploadedLayoutDir(l.id))) db.deleteLayout(l.id);
  }

  if (!db.getDefaultLayoutId()) db.setDefaultLayoutId(DEFAULT_LAYOUT_ID);
}

module.exports = { seedBuiltinLayouts, bundleChecksum };
