/**
 * Migration 027 renames persons to profiles across the schema. It runs over prod
 * data on deploy, so it is tested against a database that already holds rows:
 * every row, id and foreign key must survive the rename.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');

/** A raw database with every migration below `stop` applied. */
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

const names = (db, type) =>
  db
    .prepare('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((r) => r.name);

describe('migration 027 — persons become profiles', () => {
  let db;
  let pid;
  beforeEach(() => {
    db = upTo(27);
    const ownerId = db.prepare("SELECT id FROM users WHERE role='owner'").get().id;
    db.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Someone', ownerId);
    pid = db.prepare("SELECT id FROM persons WHERE name='Someone'").get().id;
    db.prepare('INSERT INTO sections (person_id, slug, type) VALUES (?, ?, ?)').run(
      pid,
      'summary',
      'summary',
    );
    db.prepare("INSERT INTO variants (person_id, name, kind) VALUES (?, 'CV', 'cv')").run(pid);
    db.prepare(
      "INSERT INTO person_settings (person_id, key, value) VALUES (?, 'personal.firstName', 'S')",
    ).run(pid);
    require(path.join(MIGRATIONS, '027_rename_persons_to_profiles'))(db);
  });
  afterEach(() => db.close());

  test('renames the tables, columns and indexes', () => {
    const tables = names(db, 'table');
    expect(tables).toEqual(expect.arrayContaining(['profiles', 'profile_settings']));
    expect(tables).not.toEqual(expect.arrayContaining(['persons']));
    expect(tables).not.toEqual(expect.arrayContaining(['person_settings']));
    const leftover = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE sql LIKE '%person_id%' OR sql LIKE '%persons%' OR name LIKE '%person' OR name LIKE '%persons%'",
      )
      .all();
    expect(leftover).toEqual([]);
    expect(names(db, 'index')).toEqual(
      expect.arrayContaining(['idx_profiles_user', 'idx_sections_profile', 'idx_variants_profile']),
    );
  });

  test('keeps every row, id and foreign key', () => {
    expect(db.prepare('SELECT id, name FROM profiles').all()).toEqual([
      { id: pid, name: 'Someone' },
    ]);
    expect(db.prepare('SELECT profile_id FROM sections').get().profile_id).toBe(pid);
    expect(db.prepare('SELECT profile_id FROM variants').get().profile_id).toBe(pid);
    expect(
      db.prepare('SELECT value FROM profile_settings WHERE profile_id = ?').get(pid).value,
    ).toBe('S');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  test('deleting a profile still cascades to its content', () => {
    db.prepare('DELETE FROM profiles WHERE id = ?').run(pid);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sections').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM variants').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM profile_settings').get().n).toBe(0);
  });
});
