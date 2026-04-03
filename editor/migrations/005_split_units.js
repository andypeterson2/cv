const LATEX_UNITS = require('../lib/latex-units');

module.exports = function migrate(db) {
    const unitsSql = LATEX_UNITS.map(u => `'${u}'`).join(',');
    const unitsRegex = new RegExp(`^(-?\\d*\\.?\\d+)\\s*(${LATEX_UNITS.join('|')})$`);

    // Recreate table with typed unit column (ALTER TABLE ADD COLUMN doesn't support CHECK)
    db.exec(`ALTER TABLE settings RENAME TO settings_old`);
    db.exec(`CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      value_num REAL,
      value_unit TEXT CHECK(value_unit IS NULL OR value_unit IN (${unitsSql})),
      value_legacy TEXT
    )`);
    db.exec(`INSERT INTO settings (key, value) SELECT key, value FROM settings_old`);
    db.exec(`DROP TABLE settings_old`);

    // Parse and migrate spacing.* and fonts.* rows
    const rows = db.prepare(
      `SELECT key, value FROM settings WHERE key LIKE 'spacing.%' OR key LIKE 'fonts.%'`
    ).all();
    const update = db.prepare(
      `UPDATE settings SET value_num = ?, value_unit = ?, value_legacy = value WHERE key = ?`
    );
    for (const row of rows) {
      const m = (row.value || '').match(unitsRegex);
      if (m) update.run(parseFloat(m[1]), m[2], row.key);
    }
};
