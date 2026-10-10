const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');

test('migration 030 adds layout sources and the commit columns', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
  for (const f of fs
    .readdirSync(MIGRATIONS)
    .filter((x) => (x.endsWith('.sql') || x.endsWith('.js')) && !x.includes('rollback'))
    .sort()) {
    if (parseInt(f, 10) >= 30) break;
    if (f.endsWith('.sql')) db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf-8'));
    else require(path.join(MIGRATIONS, f))(db);
  }
  require(path.join(MIGRATIONS, '030_layout_sources'))(db);
  const cols = db
    .prepare('PRAGMA table_info(layouts)')
    .all()
    .map((c) => c.name);
  expect(cols).toEqual(expect.arrayContaining(['source_sha', 'source_ref']));
  const owner = db.prepare("SELECT id FROM users WHERE role='owner'").get().id;
  db.prepare(
    "INSERT INTO layout_sources (family, user_id, repo_owner, repo_name, track) VALUES ('u1-x', ?, 'a', 'b', 'branch')",
  ).run(owner);
  expect(() =>
    db
      .prepare(
        "INSERT INTO layout_sources (family, user_id, repo_owner, repo_name, track) VALUES ('u1-y', ?, 'a', 'b', 'nightly')",
      )
      .run(owner),
  ).toThrow(/CHECK/);
  require(path.join(MIGRATIONS, '030_layout_sources'))(db); // safe to run twice
  db.close();
});
