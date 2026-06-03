/**
 * 009 — Tag catalog: a per-person controlled vocabulary.
 *
 * The catalog is the PRESCRIPTIVE counterpart to the two existing tag concepts:
 *   - usage vocab (entry_tags/item_tags, surfaced by listTagsWithCounts) — DESCRIPTIVE
 *   - tag_aliases (008) — synonym folding at write time
 *   - tag_catalog (this) — the curated target set a person INTENDS to use
 *
 * It's a SOFT guide: nothing rejects a tag for being absent from the catalog.
 * The suggest scorer (lib/suggest.js) simply ranks catalog members ahead of
 * incidental usage tags, steering the author toward a consistent vocabulary.
 * `tag` is stored canonical (normTag-normalized) so it can never disagree with
 * a stored tag's canonical form.
 *
 * Mirrors 008_fuzzy_tags.js: own frozen normTag snapshot (migrations must not
 * import evolving app code), wrapped in db.transaction, auto-registered by the
 * filename-sorted migration runner.
 */

// Frozen snapshot of lib/db.js normTag (as of 008/009). Never edit in place —
// add a later migration if the normalizer changes.
function normTag(t) {
  return String(t)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // unify whitespace / underscores → hyphen
    .replace(/-+/g, '-') // collapse repeated hyphens
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

const DDL = `
CREATE TABLE tag_catalog (
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  tag         TEXT    NOT NULL,
  description TEXT,
  category    TEXT,
  PRIMARY KEY (person_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_tag_catalog_category ON tag_catalog(person_id, category);
`;

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    db.exec(DDL);
  });
  tx();
};

// Exported only so a test could assert the snapshot matches lib/db.js normTag.
module.exports._normTag = normTag;
