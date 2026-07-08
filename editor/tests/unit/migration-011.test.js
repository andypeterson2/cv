/**
 * Migration 011 backfill — the one path the normal (empty-DB) suite can't cover:
 * copying the legacy per-person cover-letter header into each existing
 * coverletter variant. Build a realistic pre-011 DB by hand, run the migration,
 * and assert. This is what runs against prod data on deploy, so it's tested.
 */
const Database = require('better-sqlite3');
const migrate011 = require('../../migrations/011_variant_letter_header');

/** Minimal pre-011 schema (just the tables 011 reads + backfills into). */
function preDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE persons (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE variants (id INTEGER PRIMARY KEY, person_id INTEGER, name TEXT, kind TEXT);
    CREATE TABLE person_settings (person_id INTEGER, key TEXT, value TEXT, PRIMARY KEY (person_id, key));
  `);
  return db;
}

describe('migration 011 — per-variant letter header backfill', () => {
  test('copies the shared person header into every coverletter variant; ignores cv variants', () => {
    const db = preDb();
    db.prepare('INSERT INTO persons (id, name) VALUES (1, ?)').run('Andrew');
    db.prepare("INSERT INTO variants VALUES (10, 1, 'To Acme', 'coverletter')").run();
    db.prepare("INSERT INTO variants VALUES (11, 1, 'To Globex', 'coverletter')").run();
    db.prepare("INSERT INTO variants VALUES (12, 1, 'My CV', 'cv')").run();
    for (const [k, v] of [
      ['recipientName', 'Acme'],
      ['recipientAddress', '1 Terminal Way'],
      ['opening', 'Dear Acme,'],
      ['closing', 'Best,'],
    ]) {
      db.prepare('INSERT INTO person_settings VALUES (1, ?, ?)').run('coverletter.' + k, v);
    }

    migrate011(db);

    const get = db.prepare(
      'SELECT recipient_name, recipient_address, opening, closing FROM variant_letter_header WHERE variant_id = ?'
    );
    const shared = { recipient_name: 'Acme', recipient_address: '1 Terminal Way', opening: 'Dear Acme,', closing: 'Best,' };
    expect(get.get(10)).toEqual(shared); // both letters inherit the shared header
    expect(get.get(11)).toEqual(shared);
    expect(get.get(12)).toBeUndefined(); // cv variant gets no header row
    db.close();
  });

  test('a coverletter variant with no person header backfills to empty strings', () => {
    const db = preDb();
    db.prepare('INSERT INTO persons (id, name) VALUES (1, ?)').run('NoHeader');
    db.prepare("INSERT INTO variants VALUES (20, 1, 'CL', 'coverletter')").run();

    migrate011(db);

    expect(
      db.prepare('SELECT recipient_name, opening FROM variant_letter_header WHERE variant_id = 20').get()
    ).toEqual({ recipient_name: '', opening: '' });
    db.close();
  });
});
