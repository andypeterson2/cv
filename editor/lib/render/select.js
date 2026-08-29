/**
 * Resolve which layout bundle compiles a given variant.
 *
 * Order: the variant's own layout_id, then the global default
 * (settings['layout.default']), then the builtin default. Each candidate must
 * exist as an `active` DB row; otherwise we fall through. As a last resort —
 * e.g. an empty DB before the boot seed — we point at the builtin bundle on
 * disk so a compile never hard-fails on layout resolution.
 */
const { DEFAULT_LAYOUT_ID, builtinLayoutDir, layoutDirForRow } = require('./layouts');

/**
 * @param {object} db - CvDatabase instance
 * @param {object} variant - a variant row (with .layoutId, .kind)
 * @returns {{ id: string, dir: string, fallback: boolean }}
 */
function selectLayout(db, variant) {
  const candidates = [
    variant && variant.layoutId,
    db.getDefaultLayoutId && db.getDefaultLayoutId(),
    DEFAULT_LAYOUT_ID,
  ].filter(Boolean);

  for (const id of candidates) {
    const row = db.getLayout ? db.getLayout(id) : null;
    if (!row || row.status !== 'active') continue;
    // If the chosen layout doesn't support this kind, skip to the next candidate.
    if (variant && variant.kind && Array.isArray(row.kinds) && !row.kinds.includes(variant.kind))
      continue;
    return { id, dir: layoutDirForRow(row), fallback: false };
  }

  return { id: DEFAULT_LAYOUT_ID, dir: builtinLayoutDir(DEFAULT_LAYOUT_ID), fallback: true };
}

module.exports = { selectLayout };
