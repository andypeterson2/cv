#!/usr/bin/env node
/**
 * Pre-007 snapshot — run ONCE against the existing cv.db BEFORE deploying the
 * normalized (007) app, while the database is still on the old schema.
 *
 * In the old model the ACTIVE person's authoritative content lives in the live
 * working tables, and its persons.data blob may be stale. Migration 007 reads
 * blobs only, so this script flushes the active person's working tables into
 * its blob first — otherwise the most-edited person migrates stale content.
 *
 * Self-contained (raw better-sqlite3, no CvDatabase/migration-runner) so that
 * merely opening the DB does NOT trigger migration 007. It exactly reproduces
 * the old getAllForExport() blob shape.
 *
 * Usage:
 *   node editor/scripts/pre-007-snapshot.cjs [path/to/cv.db]
 * Default path: ../../cv.db relative to this script (packages/cv/cv.db).
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', '..', 'cv.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

// Refuse to run after 007 (old tables already renamed away).
const migrated = db.prepare("SELECT 1 FROM _migrations WHERE name='007_normalize.js'").get();
if (migrated || !tableExists('document_sections')) {
  console.log('pre-007-snapshot: database already migrated (007 applied) — nothing to do.');
  db.close();
  process.exit(0);
}

const activeRow = db.prepare("SELECT value FROM settings WHERE key='_active_person_id'").get();
const activeId = activeRow ? parseInt(activeRow.value, 10) : null;
if (!activeId) {
  console.log('pre-007-snapshot: no active person — nothing to flush.');
  db.close();
  process.exit(0);
}

// ---- Reproduce getAllForExport() from the live working tables ----
const settingsByPrefix = (prefix) => {
  const rows = db.prepare("SELECT key, value, value_num, value_unit FROM settings WHERE key LIKE ? || '%'").all(prefix + '.');
  const out = {};
  for (const r of rows) {
    out[r.key.slice(prefix.length + 1)] = (r.value_num != null && r.value_unit != null)
      ? { num: r.value_num, unit: r.value_unit } : r.value;
  }
  return out;
};

const personal = settingsByPrefix('personal');

const sections = db.prepare('SELECT id, type, title FROM sections ORDER BY id').all().map((s) => ({
  ...s,
  entries: db.prepare('SELECT id, section_id, sort_order, fields, resume_included FROM entries WHERE section_id = ? ORDER BY sort_order').all(s.id).map((e) => ({
    id: e.id,
    section_id: e.section_id,
    sort_order: e.sort_order,
    fields: JSON.parse(e.fields),
    resumeIncluded: !!e.resume_included,
    items: db.prepare('SELECT id, entry_id, sort_order, content, resume_included, title FROM items WHERE entry_id = ? ORDER BY sort_order').all(e.id).map((i) => ({
      id: i.id,
      entry_id: i.entry_id,
      sort_order: i.sort_order,
      content: i.content,
      resumeIncluded: !!i.resume_included,
      title: i.title,
    })),
  })),
}));

const documents = {};
for (const variant of ['cv', 'resume']) {
  documents[variant] = db.prepare('SELECT section_id, enabled, sort_order, resume_paragraph_text FROM document_sections WHERE variant = ? ORDER BY sort_order').all(variant).map((r) => ({
    sectionId: r.section_id,
    enabled: !!r.enabled,
    sortOrder: r.sort_order,
    resumeParagraphText: r.resume_paragraph_text,
  }));
}

const coverletter = settingsByPrefix('coverletter');
coverletter.sections = db.prepare('SELECT id, sort_order, title, body FROM coverletter_sections ORDER BY sort_order').all();

const blob = JSON.stringify({ personal, sections, documents, coverletter });
db.prepare('UPDATE persons SET data = ? WHERE id = ?').run(blob, activeId);
db.pragma('wal_checkpoint(TRUNCATE)');

const name = db.prepare('SELECT name FROM persons WHERE id = ?').get(activeId);
console.log(`pre-007-snapshot: flushed active person #${activeId} (${name ? name.name : '?'}) — ${sections.length} sections, ${blob.length} bytes.`);
db.close();
