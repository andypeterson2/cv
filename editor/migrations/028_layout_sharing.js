/**
 * Shared layouts. A published layout is an immutable copy of an upload, stored as
 * its own row (`<family>@<n>`), so variants and account defaults keep pinning a
 * single layout id. Each row gains:
 *   - family / version_no: the upload it was published from and its number there;
 *   - state: private | pending | public | unlisted | rejected (who may see it);
 *   - published_at, review_note, compile_ms: the owner's review record.
 *
 * Verification against real résumé data now lands in `layout_reports`, one row per
 * (layout, account), so nobody's CV text is stored where another account can read
 * it. `layouts.report` keeps only the fixture checks.
 */
const isRealSample = (check) => typeof check.name === 'string' && check.name.includes(':real:');

module.exports = function migrate(db) {
  const cols = db
    .prepare('PRAGMA table_info(layouts)')
    .all()
    .map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE layouts ADD COLUMN ${ddl}`);
  };

  db.transaction(() => {
    add('family', 'family TEXT');
    add('version_no', 'version_no INTEGER');
    add(
      'state',
      "state TEXT NOT NULL DEFAULT 'private' CHECK (state IN ('private','pending','public','unlisted','rejected'))",
    );
    add('published_at', 'published_at TEXT');
    add('review_note', 'review_note TEXT');
    add('compile_ms', 'compile_ms INTEGER');
    db.exec('UPDATE layouts SET family = id WHERE family IS NULL');
    db.exec("UPDATE layouts SET state = 'public' WHERE source = 'builtin'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_layouts_family ON layouts(family, version_no)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_layouts_state ON layouts(state)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS layout_reports (
        layout_id  TEXT    NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ok         INTEGER NOT NULL,
        report     TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (layout_id, user_id)
      ) WITHOUT ROWID
    `);

    // Move each upload's stored report to its uploader, and keep only the fixture
    // checks on the shared row.
    const rows = db
      .prepare('SELECT id, user_id, report FROM layouts WHERE report IS NOT NULL')
      .all();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO layout_reports (layout_id, user_id, ok, report) VALUES (?, ?, ?, ?)',
    );
    const strip = db.prepare('UPDATE layouts SET report = ? WHERE id = ?');
    for (const row of rows) {
      let report;
      try {
        report = JSON.parse(row.report);
      } catch {
        continue;
      }
      if (!report || !Array.isArray(report.checks)) continue;
      if (row.user_id != null) insert.run(row.id, row.user_id, report.ok ? 1 : 0, row.report);
      const checks = report.checks.filter((c) => !isRealSample(c));
      strip.run(JSON.stringify({ ...report, checks }), row.id);
    }
  })();
};
