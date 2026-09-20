/**
 * Migration 025 drops columns that nothing reads, against a database that already
 * holds rows in them. This is what runs over prod data on deploy, so it is tested:
 * the drops must keep every row and every column anything does read.
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

const columns = (db, table) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe('migration 025 — dropping unread columns', () => {
  let db;
  let pid;
  beforeEach(() => {
    db = upTo(25);
    const ownerId = db.prepare("SELECT id FROM users WHERE role='owner'").get().id;
    db.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Someone', ownerId);
    pid = db.prepare("SELECT id FROM persons WHERE name='Someone'").get().id;
    db.prepare(
      'INSERT INTO versions (person_id, label, hash, doc, created_at, branch, parent_id) VALUES (?,?,?,?,?,?,?)',
    ).run(pid, 'checkpoint', 'deadbeef', '{"x":1}', 1700000000000, 'industry', null);
    db.prepare('INSERT INTO sections (person_id, slug, type) VALUES (?,?,?)').run(
      pid,
      's',
      'summary',
    );
    const sid = db.prepare('SELECT id FROM sections').get().id;
    db.prepare('INSERT INTO entries (section_id, sort_order, fields) VALUES (?,0,?)').run(
      sid,
      '{}',
    );
    const eid = db.prepare('SELECT id FROM entries').get().id;
    db.prepare(
      'INSERT INTO tag_events (person_id, target, target_id, tag, action, rank, score, scorer) VALUES (?,?,?,?,?,?,?,?)',
    ).run(pid, 'entry', eid, 'react', 'accept', 2, 0.87, 'embedding');
  });
  afterEach(() => db.close());

  it('removes the columns and the unusable index', () => {
    require('../../migrations/025_drop_unread_columns')(db);
    expect(columns(db, 'versions')).not.toContain('hash');
    expect(columns(db, 'tag_events')).not.toContain('score');
    expect(columns(db, 'tag_events')).not.toContain('scorer');
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='versions'")
      .all()
      .map((r) => r.name);
    expect(indexes).not.toContain('idx_versions_branch');
    expect(indexes).toContain('idx_versions_person'); // the one a query can use stays
  });

  it('keeps every row and everything that is read', () => {
    require('../../migrations/025_drop_unread_columns')(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM versions').get().n).toBe(1);
    expect(
      db.prepare('SELECT label, doc, created_at, branch, parent_id, tag FROM versions').get(),
    ).toEqual({
      label: 'checkpoint',
      doc: '{"x":1}',
      created_at: 1700000000000,
      branch: 'industry',
      parent_id: null,
      tag: null,
    });
    expect(db.prepare('SELECT action, rank, tag FROM tag_events').get()).toEqual({
      action: 'accept',
      rank: 2,
      tag: 'react',
    });
    expect(db.pragma('foreign_key_check').length).toBe(0);
  });

  it('is safe to run twice', () => {
    const run = () => require('../../migrations/025_drop_unread_columns')(db);
    run();
    expect(run).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM versions').get().n).toBe(1);
  });
});
