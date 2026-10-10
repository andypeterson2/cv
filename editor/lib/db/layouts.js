/**
 * Layout subsystem for CvDatabase: bundle-metadata CRUD + per-variant / per-user
 * layout selection. Bundle FILES live on disk; this stores only metadata and the
 * last verification report. Mixed onto the CvDatabase prototype.
 *
 * A builtin row carries `user_id = null`, which is what makes it visible to every
 * account. An uploaded row names the account that installed it, and only that
 * account can replace or remove it. A published version is its own row
 * (`<family>@<n>`) with a `state`: other accounts list it while `public` and keep
 * compiling it while `public` or `unlisted`. The scoped reads take the caller's
 * user id; the unscoped reads exist for the boot seed and the owner's review.
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
    userId: r.user_id ?? null,
    family: r.family ?? r.id,
    versionNo: r.version_no ?? null,
    state: r.state ?? (r.source === 'builtin' ? 'public' : 'private'),
    publishedAt: r.published_at ?? null,
    reviewNote: r.review_note ?? null,
    compileMs: r.compile_ms ?? null,
    bytes: r.bytes ?? 0,
    author: r.source === 'builtin' ? null : r.author_name || 'an account',
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
  /**
   * Builtins, `userId`'s own uploads and versions, and everyone's public versions.
   * A version row carries `updateAvailable`: the id of a newer public version of
   * the same family, or null.
   */
  listLayouts(userId) {
    const rows = this._stmts.listLayouts.all(userId ?? null).map((r) => rowToLayout(r));
    const newest = new Map();
    for (const r of rows) {
      if (r.state !== 'public' || r.versionNo == null) continue;
      const best = newest.get(r.family);
      if (!best || r.versionNo > best.versionNo) newest.set(r.family, r);
    }
    return rows.map((r) => {
      const best = r.versionNo == null ? null : newest.get(r.family);
      return { ...r, updateAvailable: best && best.versionNo > r.versionNo ? best.id : null };
    });
  }

  /**
   * A layout `userId` may compile with, or null: a builtin, a row of theirs, or
   * another account's version that is public or unlisted (pins outlive unpublishing).
   */
  getLayout(id, userId) {
    return rowToLayout(this._stmts.getLayout.get(id, userId ?? null), true);
  }

  /** Whether `userId` may newly pin `layout`: a builtin, their own, or public now. */
  canPinLayout(layout, userId) {
    if (!layout) return false;
    return layout.builtin || layout.userId === userId || layout.state === 'public';
  }

  /** Whether one of `userId`'s variants, or their default, uses `layoutId`. */
  hasLayoutPin(layoutId, userId) {
    if (this.getDefaultLayoutId(userId) === layoutId) return true;
    return Boolean(this._stmts.layoutPinnedBy.get(layoutId, userId));
  }

  /** Whether any account's variant or default uses `layoutId`. */
  layoutInUse(layoutId) {
    return Boolean(this._stmts.layoutInUse.get({ id: layoutId }));
  }

  layoutChecksumInUse(checksum) {
    return Boolean(this._stmts.layoutChecksumInUse.get(checksum));
  }

  nextLayoutVersion(family) {
    return this._stmts.nextLayoutVersion.get(family).n;
  }

  setLayoutState(id, state, { note = null, publishedAt = null } = {}) {
    this._stmts.setLayoutState.run(state, note, publishedAt, id);
  }

  /** Versions waiting for the owner's review, oldest first. */
  listPendingLayouts() {
    return this._stmts.pendingLayouts.all().map((r) => rowToLayout(r, true));
  }

  /** `userId`'s own verification of a layout (it may quote their résumé), or null. */
  getLayoutReport(id, userId) {
    const r = this._stmts.getLayoutReport.get(id, userId);
    return r ? { ok: !!r.ok, report: safeParse(r.report, null), createdAt: r.created_at } : null;
  }

  setLayoutReport(id, userId, report) {
    this._stmts.upsertLayoutReport.run(id, userId, report.ok ? 1 : 0, JSON.stringify(report));
  }

  /**
   * Insert or replace a layout's metadata.
   * @param {object} l - { id, name, version, engine, kinds:[], status, source, manifest, checksum, report, verified_at, userId }
   *        userId: null for a builtin, the installing account for an upload.
   */
  upsertLayout(l) {
    const userId = l.userId ?? null;
    // Sharing fields keep their stored value unless the caller sets them.
    const prev = this.getLayoutUnscoped(l.id);
    const keep = (key, fallback) => (l[key] !== undefined ? l[key] : prev ? prev[key] : fallback);
    this._stmts.upsertLayout.run({
      family: keep('family', l.id),
      version_no: keep('versionNo', null),
      state: keep('state', (l.source || 'upload') === 'builtin' ? 'public' : 'private'),
      published_at: keep('publishedAt', null),
      review_note: keep('reviewNote', null),
      compile_ms: keep('compileMs', null),
      bytes: keep('bytes', 0),
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
