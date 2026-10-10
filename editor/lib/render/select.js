/**
 * Resolve which layout bundle compiles a given variant.
 *
 * Order: the variant's own layout_id, then the owning account's default
 * (its settings['layout.default']), then the builtin default. Each candidate must
 * exist as an `active` row the owner may use; otherwise we fall through. As a last
 * resort — e.g. an empty DB before the boot seed — we point at the builtin bundle
 * on disk so a compile never hard-fails on layout resolution.
 *
 * `variants.layout_id` is a plain TEXT reference with no ownership constraint. A pin
 * can only be made on a builtin, the account's own layout, or a version that is public
 * at that moment (routes/variants.js, routes/layouts.js); here getLayout also lets a
 * pinned version keep compiling after its author unpublishes it, and still never
 * resolves another account's private, pending or rejected row.
 */
const { DEFAULT_LAYOUT_ID, builtinLayoutDir, layoutDirForRow } = require('./layouts');

/**
 * @param {object} db - CvDatabase instance
 * @param {object} variant - a variant row (with .layoutId, .kind)
 * @param {number|null} userId - the account that owns the variant's profile
 * @returns {{ id: string, dir: string, source: string, fallback: boolean }}
 */
function selectLayout(db, variant, userId = null) {
  const candidates = [
    variant && variant.layoutId,
    db.getDefaultLayoutId(userId),
    DEFAULT_LAYOUT_ID,
  ].filter(Boolean);

  for (const id of candidates) {
    // getLayout returns null for another account's upload, so an unreachable
    // candidate falls through exactly as a missing one does.
    const row = db.getLayout(id, userId);
    if (!row || row.status !== 'active') continue;
    // If the chosen layout doesn't support this kind, skip to the next candidate.
    if (variant && variant.kind && Array.isArray(row.kinds) && !row.kinds.includes(variant.kind))
      continue;
    return { id, dir: layoutDirForRow(row), source: row.source, fallback: false };
  }

  return {
    id: DEFAULT_LAYOUT_ID,
    dir: builtinLayoutDir(DEFAULT_LAYOUT_ID),
    source: 'builtin',
    fallback: true,
  };
}

module.exports = { selectLayout };
