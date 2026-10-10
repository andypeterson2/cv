/**
 * Per-variant overrides of the account's style/spacing/fonts settings. Keys keep
 * their prefix (`spacing.marginTop`) and values use the same columns as `settings`.
 * No row means the variant inherits the account value, then the default.
 */
const LATEX_UNITS = require('../lib/latex-units');

module.exports = function migrate(db) {
  const units = LATEX_UNITS.map((u) => `'${u}'`).join(',');
  db.exec(`
    CREATE TABLE variant_settings (
      variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      value      TEXT,
      value_num  REAL,
      value_unit TEXT CHECK(value_unit IS NULL OR value_unit IN (${units})),
      PRIMARY KEY (variant_id, key)
    ) WITHOUT ROWID;
  `);
};
