/**
 * 008 — Fuzzy-tag support: alias map + tag re-normalization.
 *
 * Two things:
 *   1. Create `tag_aliases` (per-person alias → canonical map). An alias is
 *      resolved to its canonical at tag/rule WRITE time, so the stored
 *      vocabulary converges and variant resolution stays exact (no schema
 *      change to entry_tags/item_tags/variant_rules needed for that).
 *   2. Re-normalize every existing tag with the new, slightly stronger
 *      normalizer (unicode-fold + unify whitespace/underscore → hyphen). Old
 *      tags were only lowercased/trimmed, so a stored "front end" or
 *      "machine_learning" must collapse to "front-end" / "machine-learning" to
 *      match newly-written tags. Collisions are de-duplicated.
 *
 * The normalizer here is a FROZEN SNAPSHOT of lib/db.js normTag at the time of
 * writing — migrations must not import evolving app code (mirrors 007's note on
 * latex-type-map).
 */

// Frozen snapshot of lib/db.js normTag (008). Keep in sync only by adding a
// LATER migration, never by editing this one.
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
CREATE TABLE tag_aliases (
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  alias     TEXT    NOT NULL,
  canonical TEXT    NOT NULL,
  source    TEXT    NOT NULL DEFAULT 'manual',
  PRIMARY KEY (person_id, alias)
) WITHOUT ROWID;
CREATE INDEX idx_tag_aliases_canonical ON tag_aliases(person_id, canonical);
`;

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    db.exec(DDL);

    // Rebuild each tag table with the new normalizer, de-duplicating any rows
    // that now collapse to the same key (INSERT OR IGNORE on the PK).
    renormalize(db, 'entry_tags', ['entry_id', 'tag'], 'tag');
    renormalize(db, 'item_tags', ['item_id', 'tag'], 'tag');
    renormalize(db, 'variant_rules', ['variant_id', 'tag', 'mode'], 'tag');
  });
  tx();
};

/**
 * Read every row of `table`, re-normalize the `tagCol` column, and re-insert
 * (OR IGNORE drops collisions). `cols` is the full column list to round-trip.
 */
function renormalize(db, table, cols, tagCol) {
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  db.exec(`DELETE FROM ${table}`);
  const placeholders = cols.map(() => '?').join(', ');
  const ins = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    const t = normTag(row[tagCol]);
    if (!t) continue; // a tag that normalizes to empty is dropped
    ins.run(...cols.map((c) => (c === tagCol ? t : row[c])));
  }
}
