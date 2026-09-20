/**
 * Boot seed: register the builtin layout bundles as DB rows so they're
 * listable, selectable, and FK-referenceable. Idempotent — safe to run on every
 * startup.
 *
 * Builtin bundle FILES stay read-only under BUILTIN_LAYOUTS_DIR; only metadata
 * is written to the DB. (Uploaded bundles live under CV_LAYOUTS_DIR.) A builtin
 * row carries a null owner, which is what makes it visible to every account.
 *
 * No default is written here. Each account's default is its own settings row, and
 * an account without one falls through to the builtin in lib/render/select.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BUILTIN_LAYOUTS_DIR, uploadedLayoutDir } = require('./layouts');
const { loadLayout } = require('./loader');

/** Stable hash of a bundle's manifest + template sources, for drift detection. */
function bundleChecksum(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(njk|json)$/.test(name)) {
        h.update(name);
        h.update(fs.readFileSync(full));
      }
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
    try {
      ({ manifest } = loadLayout(dir));
    } catch {
      continue;
    }
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
      userId: null,
    });
  }
  // Reconcile DB/disk state: drop uploaded rows whose bundle dir vanished (e.g. the
  // layouts volume was reset but the DB persisted). This runs for every account, so
  // it uses the unscoped pair rather than a caller's view.
  for (const l of db.listAllLayouts()) {
    if (l.source !== 'builtin' && !fs.existsSync(uploadedLayoutDir(l.id))) {
      db.deleteLayoutUnscoped(l.id);
    }
  }
}

module.exports = { seedBuiltinLayouts, bundleChecksum };
