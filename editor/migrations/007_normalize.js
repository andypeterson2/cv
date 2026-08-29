/**
 * 007 — Normalize to per-person main content + tag-driven variants.
 *
 * Replaces the dual "JSON blob in persons.data + active-person working tables"
 * model with a single normalized source of truth:
 *
 *   persons ─┬─ person_settings        (personal.* / coverletter.* header)
 *            ├─ sections ── entries ── items        (the main CV)
 *            │                └─ entry_tags / item_tags   (free-string tags)
 *            └─ variants ─┬─ variant_rules            (tag query)
 *                         ├─ entry_overrides / item_overrides  (sparse exceptions)
 *                         ├─ variant_sections          (section presence/order)
 *                         └─ variant_letter_sections   (cover-letter body)
 *
 * Backfill is per-person from each persons.data blob (the standalone
 * scripts/pre-007-snapshot.cjs must have flushed the active person's working
 * tables into its blob FIRST, so every blob is authoritative here).
 *
 * The old content tables are RENAMEd to *_old and kept — a later 008 drops
 * them once the new app is confirmed. persons.data is also left in place
 * (dead on arrival) until 008.
 *
 * Pattern mirrors 005_split_units.js (rename → create → copy → drop), minus
 * the drop. FK enforcement is toggled OFF for the rewrite (you cannot rename
 * cross-referencing tables safely with it on) and a manual foreign_key_check
 * gates the commit.
 */

// Self-contained legacy→semantic type map (do NOT import lib/latex-type-map —
// migrations must be frozen and independent of evolving app code). Mirrors
// LEGACY_TYPE_MAP at the time of writing; identity for already-semantic types.
const LEGACY_TYPE = {
  cventries: 'experience',
  cvskills: 'skills',
  cvhonors: 'honors',
  cvparagraph: 'summary',
  cvreferences: 'references',
};
const CVPARAGRAPH_TYPES = new Set(['summary']); // semantic types that render as cvparagraph
const normType = (t) => LEGACY_TYPE[t] || t || 'experience';

const DDL = `
CREATE TABLE person_settings (
  person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT,
  value_num  REAL,
  value_unit TEXT,
  PRIMARY KEY (person_id, key)
) WITHOUT ROWID;

CREATE TABLE sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (person_id, slug)
);
CREATE INDEX idx_sections_person ON sections(person_id, sort_order);

CREATE TABLE entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  fields     JSON    NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_entries_section ON entries(section_id, sort_order);

CREATE TABLE items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  content    TEXT    NOT NULL DEFAULT '',
  title      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_items_entry ON items(entry_id, sort_order);

CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag      TEXT    NOT NULL,
  PRIMARY KEY (entry_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag);

CREATE TABLE item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (item_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_item_tags_tag ON item_tags(tag);

CREATE TABLE variants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('cv','resume','coverletter')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (person_id, name)
);
CREATE INDEX idx_variants_person ON variants(person_id);

CREATE TABLE variant_rules (
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  tag        TEXT    NOT NULL,
  mode       TEXT    NOT NULL CHECK (mode IN ('include','exclude')),
  PRIMARY KEY (variant_id, tag)
) WITHOUT ROWID;

CREATE TABLE entry_overrides (
  variant_id    INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  entry_id      INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  included      INTEGER,
  text_override TEXT,
  sort_override INTEGER,
  PRIMARY KEY (variant_id, entry_id)
) WITHOUT ROWID;
CREATE INDEX idx_entry_overrides_entry ON entry_overrides(entry_id);

CREATE TABLE item_overrides (
  variant_id    INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  included      INTEGER,
  text_override TEXT,
  sort_override INTEGER,
  PRIMARY KEY (variant_id, item_id)
) WITHOUT ROWID;
CREATE INDEX idx_item_overrides_item ON item_overrides(item_id);

CREATE TABLE variant_sections (
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variant_id, section_id)
) WITHOUT ROWID;
CREATE INDEX idx_variant_sections_section ON variant_sections(section_id);

CREATE TABLE variant_letter_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title      TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_vls_variant ON variant_letter_sections(variant_id, sort_order);
`;

module.exports = function migrate(db) {
  // FK enforcement must be OFF to rename cross-referencing tables and to insert
  // in an order that would otherwise trip transient FK checks. Restore in finally.
  const hadFk = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');

  try {
    const tx = db.transaction(() => {
      // 1. Move old content tables aside (keep for rollback; 008 drops them).
      for (const t of [
        'sections',
        'entries',
        'items',
        'document_sections',
        'coverletter_sections',
      ]) {
        db.exec(`ALTER TABLE ${t} RENAME TO ${t}_old`);
      }

      // Old indexes (from 001) survive the rename and keep their names, which
      // would collide with the new schema's same-named indexes. Drop them; the
      // *_old tables don't need indexes (they're read-only until 008 drops them).
      for (const idx of ['idx_entries_section', 'idx_items_entry', 'idx_docsec_variant']) {
        db.exec(`DROP INDEX IF EXISTS ${idx}`);
      }

      // 2. Create the normalized schema.
      db.exec(DDL);

      // 3. Backfill every person from its blob.
      const persons = db.prepare('SELECT id, name, data FROM persons').all();
      const expect = { sections: 0, entries: 0, items: 0 };
      const skipped = [];

      const ins = {
        setting: db.prepare(
          'INSERT OR REPLACE INTO person_settings (person_id, key, value) VALUES (?,?,?)',
        ),
        section: db.prepare(
          'INSERT INTO sections (person_id, slug, type, title, sort_order) VALUES (?,?,?,?,?)',
        ),
        entry: db.prepare('INSERT INTO entries (section_id, sort_order, fields) VALUES (?,?,?)'),
        item: db.prepare(
          'INSERT INTO items (entry_id, sort_order, content, title) VALUES (?,?,?,?)',
        ),
        variant: db.prepare('INSERT INTO variants (person_id, name, kind) VALUES (?,?,?)'),
        vsection: db.prepare(
          'INSERT OR IGNORE INTO variant_sections (variant_id, section_id, enabled, sort_order) VALUES (?,?,?,?)',
        ),
        eoverride: db.prepare(
          'INSERT INTO entry_overrides (variant_id, entry_id, included, text_override) VALUES (?,?,?,?) ' +
            'ON CONFLICT(variant_id, entry_id) DO UPDATE SET ' +
            'included = COALESCE(excluded.included, entry_overrides.included), ' +
            'text_override = COALESCE(excluded.text_override, entry_overrides.text_override)',
        ),
        ioverride: db.prepare(
          'INSERT OR IGNORE INTO item_overrides (variant_id, item_id, included) VALUES (?,?,?)',
        ),
        letter: db.prepare(
          'INSERT INTO variant_letter_sections (variant_id, sort_order, title, body) VALUES (?,?,?,?)',
        ),
      };

      for (const person of persons) {
        try {
          const counts = backfillPerson(db, ins, person);
          expect.sections += counts.sections;
          expect.entries += counts.entries;
          expect.items += counts.items;
        } catch (e) {
          skipped.push(`#${person.id} (${person.name}): ${e.message}`);
          // Guarantee at least a bare CV variant so the person isn't orphaned.
          try {
            ins.variant.run(person.id, 'CV', 'cv');
          } catch {
            /* a variant may already exist from a partial pass */
          }
        }
      }

      // 4. Drop now-duplicated personal/coverletter rows from the global settings
      //    table (they live in person_settings now). Keep style/spacing/fonts and
      //    _active_person_id.
      db.exec("DELETE FROM settings WHERE key LIKE 'personal.%' OR key LIKE 'coverletter.%'");

      // 5. Validate before commit.
      const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (fkErrors.length) {
        throw new Error('007 FK check failed: ' + JSON.stringify(fkErrors.slice(0, 5)));
      }
      const got = {
        sections: db.prepare('SELECT COUNT(*) c FROM sections').get().c,
        entries: db.prepare('SELECT COUNT(*) c FROM entries').get().c,
        items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
      };
      for (const k of ['sections', 'entries', 'items']) {
        if (got[k] !== expect[k]) {
          throw new Error(`007 count mismatch for ${k}: expected ${expect[k]}, got ${got[k]}`);
        }
      }
      const noCv = db
        .prepare(
          'SELECT p.id FROM persons p WHERE NOT EXISTS ' +
            "(SELECT 1 FROM variants v WHERE v.person_id = p.id AND v.kind = 'cv')",
        )
        .all();
      if (noCv.length) {
        throw new Error('007: persons without a CV variant: ' + noCv.map((r) => r.id).join(','));
      }

      if (skipped.length) {
        console.warn(
          `007_normalize: ${skipped.length} person(s) with empty/malformed data, scaffolded bare:\n  ` +
            skipped.join('\n  '),
        );
      }
    });
    tx();
  } finally {
    db.pragma(`foreign_keys = ${hadFk ? 'ON' : 'OFF'}`);
  }
};

/**
 * Materialize one person's blob into the normalized tables + default variants.
 * Returns the {sections, entries, items} counts inserted (for validation).
 * Throws on empty/malformed data so the caller can scaffold a bare person.
 */
function backfillPerson(db, ins, person) {
  let data;
  try {
    data = JSON.parse(person.data || '{}');
  } catch {
    data = {};
  }
  const hasContent =
    data && (data.personal || (Array.isArray(data.sections) && data.sections.length));
  if (!hasContent) throw new Error('empty or malformed persons.data');

  const pid = person.id;
  const counts = { sections: 0, entries: 0, items: 0 };

  // ---- person_settings: personal.* and coverletter.* header (minus sections) ----
  if (data.personal) {
    for (const [k, v] of Object.entries(data.personal))
      ins.setting.run(pid, 'personal.' + k, valStr(v));
  }
  if (data.coverletter) {
    for (const [k, v] of Object.entries(data.coverletter)) {
      if (k === 'sections') continue;
      ins.setting.run(pid, 'coverletter.' + k, valStr(v));
    }
  }

  // ---- main section order: cv document order, then any blob sections not in cv ----
  const blobSections = Array.isArray(data.sections) ? data.sections : [];
  const cvDoc = data.documents && Array.isArray(data.documents.cv) ? data.documents.cv : [];
  const orderedSlugs = [];
  for (const d of cvDoc) {
    if (blobSections.some((s) => s.id === d.sectionId) && !orderedSlugs.includes(d.sectionId)) {
      orderedSlugs.push(d.sectionId);
    }
  }
  for (const s of blobSections) if (!orderedSlugs.includes(s.id)) orderedSlugs.push(s.id);

  // ---- sections / entries / items, capturing old→new id maps ----
  const sectionIdBySlug = {};
  const entryIdByOld = {};
  const itemIdByOld = {};
  const sectionTypeBySlug = {};
  // First resume-included entry per cvparagraph section (for paragraph text override).
  const firstResumeEntryNewIdBySlug = {};

  let sOrder = 0;
  for (const slug of orderedSlugs) {
    const sec = blobSections.find((s) => s.id === slug);
    const type = normType(sec.type);
    const newSecId = ins.section.run(pid, slug, type, sec.title || '', sOrder++).lastInsertRowid;
    sectionIdBySlug[slug] = newSecId;
    sectionTypeBySlug[slug] = type;
    counts.sections++;

    const entries = Array.isArray(sec.entries) ? sec.entries : [];
    let eOrder = 0;
    for (const e of entries) {
      const fields = JSON.stringify(e.fields || {});
      const newEntryId = ins.entry.run(newSecId, eOrder++, fields).lastInsertRowid;
      if (e.id != null) entryIdByOld[e.id] = newEntryId;
      counts.entries++;

      if (
        CVPARAGRAPH_TYPES.has(type) &&
        e.resumeIncluded !== false &&
        firstResumeEntryNewIdBySlug[slug] == null
      ) {
        firstResumeEntryNewIdBySlug[slug] = newEntryId;
      }

      const items = Array.isArray(e.items) ? e.items : [];
      let iOrder = 0;
      for (const it of items) {
        const newItemId = ins.item.run(
          newEntryId,
          iOrder++,
          it.content || '',
          it.title || '',
        ).lastInsertRowid;
        if (it.id != null) itemIdByOld[it.id] = newItemId;
        counts.items++;
      }
    }
  }

  // ---- CV variant: no rules, no overrides; explicit section list from documents.cv ----
  const cvVarId = ins.variant.run(pid, 'CV', 'cv').lastInsertRowid;
  writeVariantSections(ins, cvVarId, cvDoc, sectionIdBySlug);

  // ---- Resume variant: no rules; explicit section list + per-row exclude overrides
  //      + paragraph text overrides. (A tag rule would lose section-level filtering.) ----
  const resumeDoc =
    data.documents && Array.isArray(data.documents.resume) ? data.documents.resume : [];
  const resumeVarId = ins.variant.run(pid, 'Resume', 'resume').lastInsertRowid;
  writeVariantSections(ins, resumeVarId, resumeDoc, sectionIdBySlug);

  for (const sec of blobSections) {
    for (const e of sec.entries || []) {
      if (e.resumeIncluded === false && entryIdByOld[e.id] != null) {
        ins.eoverride.run(resumeVarId, entryIdByOld[e.id], 0, null);
      }
      for (const it of e.items || []) {
        if (it.resumeIncluded === false && itemIdByOld[it.id] != null) {
          ins.ioverride.run(resumeVarId, itemIdByOld[it.id], 0);
        }
      }
    }
  }
  for (const d of resumeDoc) {
    if (d.resumeParagraphText != null && firstResumeEntryNewIdBySlug[d.sectionId] != null) {
      ins.eoverride.run(
        resumeVarId,
        firstResumeEntryNewIdBySlug[d.sectionId],
        null,
        d.resumeParagraphText,
      );
    }
  }

  // ---- Cover Letter variant: only if there are letter paragraphs ----
  const clSections =
    data.coverletter && Array.isArray(data.coverletter.sections) ? data.coverletter.sections : [];
  if (clSections.length) {
    const clVarId = ins.variant.run(pid, 'Cover Letter', 'coverletter').lastInsertRowid;
    let clOrder = 0;
    for (const s of clSections) ins.letter.run(clVarId, clOrder++, s.title || '', s.body || '');
  }

  return counts;
}

function writeVariantSections(ins, variantId, docRows, sectionIdBySlug) {
  let order = 0;
  for (const d of docRows) {
    const secId = sectionIdBySlug[d.sectionId];
    if (secId == null) continue; // section referenced by doc but absent from blob.sections
    const enabled = d.enabled === false ? 0 : 1;
    const sortOrder = typeof d.sortOrder === 'number' ? d.sortOrder : order;
    ins.vsection.run(variantId, secId, enabled, sortOrder);
    order++;
  }
}

function valStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
