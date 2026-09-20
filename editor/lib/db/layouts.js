/**
 * Layout subsystem for CvDatabase: bundle-metadata CRUD + per-variant / per-user
 * layout selection. Bundle FILES live on disk; this stores only metadata and the
 * last verification report. Mixed onto the CvDatabase prototype.
 *
 * A builtin row carries `user_id = null`, which is what makes it visible to every
 * account. An uploaded row names the account that installed it, and only that
 * account can read, replace or remove it. The scoped reads take the caller's user
 * id; the unscoped pair exists for the boot seed and says so at its call site.
 *
 * Each account's default lives in its own `settings` row under `layout.default`,
 * reusing the per-user settings get/set (no new schema surface). An account with no
 * row has no default, and the selector falls through to the builtin.
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
    out.userId = r.user_id ?? null;
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
  /** Builtins plus `userId`'s own uploads. */
  listLayouts(userId) {
    return this._stmts.listLayouts.all(userId ?? null).map((r) => rowToLayout(r));
  }

  /** A layout `userId` may use, or null — a builtin, or an upload of theirs. */
  getLayout(id, userId) {
    return rowToLayout(this._stmts.getLayout.get(id, userId ?? null), true);
  }

  /**
   * Insert or replace a layout's metadata.
   * @param {object} l - { id, name, version, engine, kinds:[], status, source, manifest, checksum, report, verified_at, userId }
   *        userId: null for a builtin, the installing account for an upload.
   */
  upsertLayout(l) {
    const userId = l.userId ?? null;
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
      user_id: userId,
    });
    return this.getLayout(l.id, userId);
  }

  /**
   * Delete one of `userId`'s own layouts and revert any variants that referenced it.
   * Returns true if a row went. A builtin never matches, whatever is passed.
   */
  deleteLayout(id, userId) {
    let removed = false;
    const tx = this.db.transaction(() => {
      removed = this._stmts.deleteLayout.run(id, userId ?? null).changes > 0;
      if (removed) this._stmts.clearVariantLayoutFor.run(id);
    });
    tx();
    return removed;
  }

  // Unscoped — SYSTEM use only (the boot seed reconciling rows against disk).
  // Request handlers must go through the scoped methods above.

  listAllLayouts() {
    return this._stmts.listAllLayouts.all().map((r) => rowToLayout(r));
  }

  getLayoutUnscoped(id) {
    return rowToLayout(this._stmts.getLayoutUnscoped.get(id), true);
  }

  deleteLayoutUnscoped(id) {
    const tx = this.db.transaction(() => {
      this._stmts.clearVariantLayoutFor.run(id);
      this._stmts.deleteLayoutUnscoped.run(id);
    });
    tx();
  }

  setVariantLayout(variantId, layoutId) {
    this._stmts.setVariantLayout.run(layoutId ?? null, variantId);
  }

  clearVariantLayoutFor(layoutId) {
    this._stmts.clearVariantLayoutFor.run(layoutId);
  }

  getDefaultLayoutId(userId) {
    return this.getSettings('layout', userId)[DEFAULT_LAYOUT_KEY] || null;
  }

  setDefaultLayoutId(id, userId) {
    this.setSettings({ [DEFAULT_LAYOUT_KEY]: id }, userId);
  }
}

module.exports = LayoutStore;
module.exports.rowToLayout = rowToLayout;
