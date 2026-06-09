/**
 * 010 — Layouts: make the LaTeX layout a first-class, selectable, uploadable
 * entity instead of the single hardcoded awesome-cv class.
 *
 *   layouts            one row per installed layout bundle (builtin or uploaded).
 *                      Bundle FILES live on disk (builtin: editor/layouts/<id>;
 *                      uploaded: CV_LAYOUTS_DIR/<id>); this table is the metadata
 *                      + last verification report.
 *   variants.layout_id nullable per-variant choice. Resolution is
 *                      variant.layout_id ?? settings['layout.default'] ?? builtin,
 *                      so NULL just means "use the default".
 *
 * The FK uses ON DELETE SET NULL so removing a layout reverts its variants to the
 * default. SQLite's enforcement of an FK added via ALTER ADD COLUMN is
 * version-dependent, so the app ALSO clears the column on delete
 * (clearVariantLayoutFor) and the selector falls back if a row is missing.
 *
 * Follows the 009 pattern: DDL wrapped in db.transaction, auto-registered by the
 * filename-sorted migration runner.
 */

const DDL = `
CREATE TABLE layouts (
  id          TEXT PRIMARY KEY,           -- manifest id (slug)
  name        TEXT NOT NULL,
  version     TEXT,
  engine      TEXT NOT NULL DEFAULT 'nunjucks',
  kinds       TEXT NOT NULL,              -- JSON array of supported doc kinds
  status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'invalid'
  source      TEXT NOT NULL DEFAULT 'upload', -- 'builtin' | 'upload'
  manifest    TEXT,                       -- full manifest JSON
  checksum    TEXT,                       -- bundle hash (seed/drift guard)
  report      TEXT,                       -- last verification report JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
) WITHOUT ROWID;

ALTER TABLE variants ADD COLUMN layout_id TEXT REFERENCES layouts(id) ON DELETE SET NULL;
`;

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    db.exec(DDL);
  });
  tx();
};
