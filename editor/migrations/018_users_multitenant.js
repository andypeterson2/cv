/**
 * An ownership layer under `persons`.
 *
 * Adds a `users` table and gives every person an owner (`persons.user_id`), so a
 * signed-in account sees only its own persons. Two sentinel accounts bootstrap it:
 * '@system' owns the public demo (the person(s) on CV_PUBLIC_PERSON_IDS), and
 * '@owner' owns everything else.
 *
 * Additive on purpose: `persons.name` keeps its global UNIQUE. Per-user uniqueness
 * (UNIQUE(user_id, name)) needs a table rebuild, and only '@owner' and '@system'
 * exist, so names cannot collide.
 */
module.exports = function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT NOT NULL UNIQUE,
      email      TEXT,
      name       TEXT,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const insUser = db.prepare(
    'INSERT OR IGNORE INTO users (google_sub, email, name, role) VALUES (?, ?, ?, ?)',
  );
  insUser.run('@system', 'system@local', 'Demo', 'system');
  insUser.run(
    '@owner',
    process.env.OWNER_EMAIL || 'owner@local',
    process.env.OWNER_NAME || 'Owner',
    'owner',
  );

  const uid = (sub) => db.prepare('SELECT id FROM users WHERE google_sub = ?').get(sub).id;
  const systemId = uid('@system');
  const ownerId = uid('@owner');

  // Add ownership to persons (nullable FK so ALTER is safe; new rows always set it).
  const cols = db
    .prepare('PRAGMA table_info(persons)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('user_id')) {
    db.exec('ALTER TABLE persons ADD COLUMN user_id INTEGER REFERENCES users(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id)');
  }

  // Backfill: public demo persons → @system; everything else → @owner.
  const publicIds = new Set(
    String(process.env.CV_PUBLIC_PERSON_IDS || '1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const setOwner = db.prepare('UPDATE persons SET user_id = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id FROM persons').all()) {
    setOwner.run(publicIds.has(String(row.id)) ? systemId : ownerId, row.id);
  }
};
