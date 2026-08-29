/**
 * Layout subsystem for CvDatabase: bundle-metadata CRUD + per-variant / global
 * layout selection. Bundle FILES live on disk; this stores only metadata and the
 * last verification report. Mixed onto the prototype (applyMixin in db.js).
 *
 * The global default lives in the `settings` table under `layout.default`,
 * reusing the existing settings get/set (no new schema surface).
 */
const DEFAULT_LAYOUT_KEY = 'layout.default';

function rowToLayout(r, full = false) {
  if (!r) return null;
  const out = {
    id: r.id,
    name: r.name,
    version: r.version,
    engine: r.engine,
    kinds: safeParse(r.kinds, []),
    status: r.status,
    source: r.source,
    checksum: r.checksum,
    created_at: r.created_at,
    verified_at: r.verified_at,
    builtin: r.source === 'builtin',
  };
  if (full) {
    out.manifest = safeParse(r.manifest, null);
    out.report = safeParse(r.report, null);
  }
  return out;
}

function safeParse(json, fallback) {
  if (json == null) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

class LayoutStore {
  listLayouts() {
    return this._stmts.listLayouts.all().map((r) => rowToLayout(r));
  }

  getLayout(id) {
    return rowToLayout(this._stmts.getLayout.get(id), true);
  }

  /**
   * Insert or replace a layout's metadata.
   * @param {object} l - { id, name, version, engine, kinds:[], status, source, manifest, checksum, report, verified_at }
   */
  upsertLayout(l) {
    this._stmts.upsertLayout.run({
      id: l.id,
      name: l.name || l.id,
      version: l.version ?? null,
      engine: l.engine || 'nunjucks',
      kinds: JSON.stringify(l.kinds || []),
      status: l.status || 'active',
      source: l.source || 'upload',
      manifest:
        l.manifest == null
          ? null
          : typeof l.manifest === 'string'
            ? l.manifest
            : JSON.stringify(l.manifest),
      checksum: l.checksum ?? null,
      report:
        l.report == null
          ? null
          : typeof l.report === 'string'
            ? l.report
            : JSON.stringify(l.report),
      verified_at: l.verified_at ?? null,
    });
    return this.getLayout(l.id);
  }

  /** Delete a layout and revert any variants that referenced it to the default. */
  deleteLayout(id) {
    const tx = this.db.transaction(() => {
      this._stmts.clearVariantLayoutFor.run(id);
      this._stmts.deleteLayout.run(id);
    });
    tx();
  }

  setVariantLayout(variantId, layoutId) {
    this._stmts.setVariantLayout.run(layoutId ?? null, variantId);
  }

  clearVariantLayoutFor(layoutId) {
    this._stmts.clearVariantLayoutFor.run(layoutId);
  }

  getDefaultLayoutId() {
    return this.getSettings('layout')[DEFAULT_LAYOUT_KEY] || null;
  }

  setDefaultLayoutId(id) {
    this.setSettings({ [DEFAULT_LAYOUT_KEY]: id });
  }
}

module.exports = LayoutStore;
module.exports.rowToLayout = rowToLayout;
