/**
 * Migration 028 adds layout sharing over existing rows: uploads become private,
 * builtins public, and each stored report is split so the uploader keeps the
 * real-data checks and the shared row keeps only fixture checks.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');

function upTo(stop) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  for (const f of fs
    .readdirSync(MIGRATIONS)
    .filter((x) => (x.endsWith('.sql') || x.endsWith('.js')) && !x.includes('rollback'))
    .sort()) {
    if (parseInt(f, 10) >= stop) break;
    if (f.endsWith('.sql')) db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf-8'));
    else require(path.join(MIGRATIONS, f))(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
  }
  return db;
}

test('existing rows get sharing state and their reports split', () => {
  const db = upTo(28);
  const ownerId = db.prepare("SELECT id FROM users WHERE role='owner'").get().id;
  const report = {
    ok: true,
    checks: [
      { name: 'compile:fixture:cv', ok: true },
      { name: 'compile:real:5:cv', ok: true, log: 'Andrew Peterson ...' },
    ],
  };
  db.prepare(
    "INSERT INTO layouts (id, name, kinds, source, report, user_id) VALUES ('u1-x', 'X', '[\"cv\"]', 'upload', ?, ?)",
  ).run(JSON.stringify(report), ownerId);
  db.prepare(
    "INSERT INTO layouts (id, name, kinds, source) VALUES ('awesome-cv', 'A', '[\"cv\"]', 'builtin')",
  ).run();

  require(path.join(MIGRATIONS, '028_layout_sharing'))(db);

  const up = db.prepare("SELECT family, state, report FROM layouts WHERE id = 'u1-x'").get();
  expect(up.family).toBe('u1-x');
  expect(up.state).toBe('private');
  expect(JSON.parse(up.report).checks.map((c) => c.name)).toEqual(['compile:fixture:cv']);
  const kept = db
    .prepare("SELECT user_id, report FROM layout_reports WHERE layout_id = 'u1-x'")
    .get();
  expect(kept.user_id).toBe(ownerId);
  expect(JSON.parse(kept.report).checks).toHaveLength(2);
  expect(db.prepare("SELECT state FROM layouts WHERE id = 'awesome-cv'").get().state).toBe(
    'public',
  );
  expect(() => db.prepare("UPDATE layouts SET state = 'bogus' WHERE id = 'u1-x'").run()).toThrow(
    /CHECK/,
  );
  db.close();
});
