/**
 * Migration 031 puts `score` and `scorer` back on tag_events, against a database
 * that already holds rows written without them. This runs over prod data on
 * deploy and over a table whose rows cannot be regenerated, so the two things
 * that matter are tested: existing rows survive, and a second run does nothing.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');
const MIGRATION = '031_restore_tag_event_provenance.js';

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

const columns = (db, table) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

const apply = (db) => require(path.join(MIGRATIONS, MIGRATION))(db);

/**
 * A profile to hang events off, through the raw schema. Ids well clear of the
 * seeded sample profile the earlier migrations create.
 */
function seed(db) {
  db.prepare("INSERT INTO users (id, google_sub) VALUES (9001, 'sub-9001')").run();
  db.prepare("INSERT INTO profiles (id, user_id, name) VALUES (9001, 9001, 'P')").run();
  return 9001;
}

let db;

afterEach(() => db?.close());

test('025 left the columns off, so 031 has something to do', () => {
  db = upTo(31);
  expect(columns(db, 'tag_events')).not.toContain('score');
  expect(columns(db, 'tag_events')).not.toContain('scorer');
});

test('031 adds both columns', () => {
  db = upTo(31);
  apply(db);
  const cols = columns(db, 'tag_events');
  expect(cols).toContain('score');
  expect(cols).toContain('scorer');
});

test('rows written before 031 survive it, holding NULL in the new columns', () => {
  db = upTo(31);
  const pid = seed(db);
  db.prepare(
    'INSERT INTO tag_events (profile_id, target, target_id, tag, action, rank) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(pid, 'item', 7, 'backend', 'accept', 0);

  apply(db);

  const rows = db.prepare('SELECT tag, action, rank, score, scorer FROM tag_events').all();
  expect(rows).toEqual([{ tag: 'backend', action: 'accept', rank: 0, score: null, scorer: null }]);
});

test('running 031 twice is a no-op, and keeps the rows', () => {
  db = upTo(31);
  const pid = seed(db);
  apply(db);
  db.prepare(
    'INSERT INTO tag_events (profile_id, target, target_id, tag, action, rank, score, scorer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(pid, 'item', 7, 'backend', 'accept', 0, 0.41, 'embedding');

  expect(() => apply(db)).not.toThrow();

  expect(columns(db, 'tag_events').filter((c) => c === 'score')).toHaveLength(1);
  expect(db.prepare('SELECT score, scorer FROM tag_events').all()).toEqual([
    { score: 0.41, scorer: 'embedding' },
  ]);
});

test('a score and scorer round-trip through the restored columns', () => {
  db = upTo(31);
  const pid = seed(db);
  apply(db);
  db.prepare(
    'INSERT INTO tag_events (profile_id, target, target_id, tag, action, rank, score, scorer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(pid, 'entry', 3, 'leadership', 'dismiss', 2, -0.2, 'embedding-ft');

  expect(db.prepare('SELECT score, scorer FROM tag_events').get()).toEqual({
    score: -0.2,
    scorer: 'embedding-ft',
  });
});
