const path = require('path');
const fs = require('fs');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Run pending migrations against a better-sqlite3 database instance.
 * Migrations are .sql or .js files in the migrations/ directory.
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => r.name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => (f.endsWith('.sql') || f.endsWith('.js')) && !f.includes('rollback'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      db.exec(sql);
    } else if (file.endsWith('.js')) {
      const migrate = require(path.join(MIGRATIONS_DIR, file));
      migrate(db);
    }
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
}

module.exports = runMigrations;
