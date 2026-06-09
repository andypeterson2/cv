/**
 * SQLite access layer for the CV Editor (normalized, stateless model).
 *
 * Single source of truth — every person owns a master CV (sections → entries →
 * items, with free-string tags) plus named variants. A variant is a lightweight
 * overlay: a tag query (variant_rules) + sparse per-entry/item exceptions
 * (entry_overrides / item_overrides) + a section list (variant_sections), or —
 * for coverletter-kind variants — a list of letter paragraphs.
 *
 * There is NO "active person" and NO JSON-blob working copy. All ids are stable
 * and every method takes the ids it operates on, so callers (REST, MCP) are
 * fully addressable and stateless.
 *
 * Style/spacing/fonts remain GLOBAL (the `settings` table); personal info and
 * the cover-letter header are per-person (`person_settings`).
 */

const Database = require('better-sqlite3');
const runMigrations = require('./migration-runner');
const { normalizeType } = require('./latex-type-map');
const { rowToSection } = require('./db/helpers');
const { applyMixin } = require('./db/_mixin');

class CvDatabase {
  /**
   * @param {string} dbPath - Path to SQLite file, or ':memory:' for tests
   */
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
    this._prepareStatements();
    this.seedJaneDoe();
  }

  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  _prepareStatements() {
    const p = (sql) => this.db.prepare(sql);
    this._stmts = {
      // Global settings (style/spacing/fonts)
      getSettings: p("SELECT key, value, value_num, value_unit FROM settings WHERE key LIKE ? || '%'"),
      upsertSetting: p('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      upsertSettingUnit: p('INSERT INTO settings (key, value, value_num, value_unit) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_num = excluded.value_num, value_unit = excluded.value_unit'),

      // Person settings (personal.* / coverletter.*)
      getPersonSettings: p("SELECT key, value, value_num, value_unit FROM person_settings WHERE person_id = ? AND key LIKE ? || '%'"),
      upsertPersonSetting: p('INSERT INTO person_settings (person_id, key, value) VALUES (?, ?, ?) ON CONFLICT(person_id, key) DO UPDATE SET value = excluded.value'),
      deletePersonSetting: p('DELETE FROM person_settings WHERE person_id = ? AND key = ?'),

      // Persons
      getPersons: p('SELECT id, name, created_at FROM persons ORDER BY id'),
      getPerson: p('SELECT id, name, created_at FROM persons WHERE id = ?'),
      insertPerson: p('INSERT INTO persons (name) VALUES (?)'),
      updatePersonName: p('UPDATE persons SET name = ? WHERE id = ?'),
      deletePerson: p('DELETE FROM persons WHERE id = ?'),
      countPersons: p('SELECT COUNT(*) AS cnt FROM persons'),

      // Sections
      getSectionsByPerson: p('SELECT id, person_id, slug, type, title, sort_order FROM sections WHERE person_id = ? ORDER BY sort_order, id'),
      getSection: p('SELECT id, person_id, slug, type, title, sort_order FROM sections WHERE id = ?'),
      insertSection: p('INSERT INTO sections (person_id, slug, type, title, sort_order) VALUES (?, ?, ?, ?, ?)'),
      updateSectionTitle: p('UPDATE sections SET title = ? WHERE id = ?'),
      updateSectionSlugType: p('UPDATE sections SET slug = ?, type = ?, title = ? WHERE id = ?'),
      updateSectionSortOrder: p('UPDATE sections SET sort_order = ? WHERE id = ?'),
      deleteSection: p('DELETE FROM sections WHERE id = ?'),
      maxSectionSortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sections WHERE person_id = ?'),

      // Entries
      getEntries: p('SELECT id, section_id, sort_order, fields FROM entries WHERE section_id = ? ORDER BY sort_order, id'),
      getEntry: p('SELECT id, section_id, sort_order, fields FROM entries WHERE id = ?'),
      insertEntry: p('INSERT INTO entries (section_id, sort_order, fields) VALUES (?, ?, ?)'),
      updateEntryFields: p('UPDATE entries SET fields = ? WHERE id = ?'),
      updateEntrySortOrder: p('UPDATE entries SET sort_order = ? WHERE id = ?'),
      deleteEntry: p('DELETE FROM entries WHERE id = ?'),
      maxEntrySortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM entries WHERE section_id = ?'),

      // Items
      getItems: p('SELECT id, entry_id, sort_order, content, title FROM items WHERE entry_id = ? ORDER BY sort_order, id'),
      getItem: p('SELECT id, entry_id, sort_order, content, title FROM items WHERE id = ?'),
      insertItem: p('INSERT INTO items (entry_id, sort_order, content, title) VALUES (?, ?, ?, ?)'),
      updateItemContent: p('UPDATE items SET content = ? WHERE id = ?'),
      updateItemTitle: p('UPDATE items SET title = ? WHERE id = ?'),
      updateItemSortOrder: p('UPDATE items SET sort_order = ? WHERE id = ?'),
      deleteItem: p('DELETE FROM items WHERE id = ?'),
      maxItemSortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM items WHERE entry_id = ?'),

      // Tags
      getEntryTags: p('SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag'),
      addEntryTag: p('INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?, ?)'),
      delEntryTag: p('DELETE FROM entry_tags WHERE entry_id = ? AND tag = ?'),
      getItemTags: p('SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag'),
      addItemTag: p('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)'),
      delItemTag: p('DELETE FROM item_tags WHERE item_id = ? AND tag = ?'),
      listEntryTags: p('SELECT DISTINCT et.tag FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?'),
      listItemTags: p('SELECT DISTINCT it.tag FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?'),
      countEntryTags: p('SELECT et.tag AS tag, COUNT(*) AS cnt FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ? GROUP BY et.tag'),
      countItemTags: p('SELECT it.tag AS tag, COUNT(*) AS cnt FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ? GROUP BY it.tag'),
      personForEntry: p('SELECT s.person_id AS pid FROM entries e JOIN sections s ON e.section_id = s.id WHERE e.id = ?'),
      personForItem: p('SELECT s.person_id AS pid FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE i.id = ?'),

      // Tag aliases (per-person alias → canonical)
      getAliases: p('SELECT alias, canonical, source FROM tag_aliases WHERE person_id = ? ORDER BY alias'),
      getAlias: p('SELECT canonical FROM tag_aliases WHERE person_id = ? AND alias = ?'),
      upsertAlias: p('INSERT INTO tag_aliases (person_id, alias, canonical, source) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, alias) DO UPDATE SET canonical = excluded.canonical, source = excluded.source'),
      delAlias: p('DELETE FROM tag_aliases WHERE person_id = ? AND alias = ?'),
      // Retroactive alias application: fold an existing tag into its canonical,
      // person-scoped. UPDATE OR IGNORE moves rows that don't collide; the
      // paired DELETE clears any that did (the canonical already existed).
      rewriteEntryTag: p('UPDATE OR IGNORE entry_tags SET tag = ? WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      delEntryTagP: p('DELETE FROM entry_tags WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      rewriteItemTag: p('UPDATE OR IGNORE item_tags SET tag = ? WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      delItemTagP: p('DELETE FROM item_tags WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      rewriteRuleTag: p('UPDATE OR IGNORE variant_rules SET tag = ? WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE person_id = ?)'),
      delRuleTagP: p('DELETE FROM variant_rules WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE person_id = ?)'),

      // Tag catalog (per-person controlled vocabulary)
      getCatalog: p('SELECT tag, description, category FROM tag_catalog WHERE person_id = ? ORDER BY tag'),
      upsertCatalogTag: p('INSERT INTO tag_catalog (person_id, tag, description, category) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, tag) DO UPDATE SET description = excluded.description, category = excluded.category'),
      delCatalogTag: p('DELETE FROM tag_catalog WHERE person_id = ? AND tag = ?'),

      // Variants
      getVariants: p('SELECT id, person_id, name, kind, created_at, layout_id FROM variants WHERE person_id = ? ORDER BY id'),
      getVariant: p('SELECT id, person_id, name, kind, created_at, layout_id FROM variants WHERE id = ?'),
      insertVariant: p('INSERT INTO variants (person_id, name, kind) VALUES (?, ?, ?)'),
      updateVariantName: p('UPDATE variants SET name = ? WHERE id = ?'),
      setVariantLayout: p('UPDATE variants SET layout_id = ? WHERE id = ?'),
      clearVariantLayoutFor: p('UPDATE variants SET layout_id = NULL WHERE layout_id = ?'),
      deleteVariant: p('DELETE FROM variants WHERE id = ?'),

      // Layouts (bundle metadata; files live on disk)
      listLayouts: p('SELECT id, name, version, engine, kinds, status, source, checksum, created_at, verified_at FROM layouts ORDER BY (source = \'builtin\') DESC, id'),
      getLayout: p('SELECT id, name, version, engine, kinds, status, source, manifest, checksum, report, created_at, verified_at FROM layouts WHERE id = ?'),
      upsertLayout: p(`INSERT INTO layouts (id, name, version, engine, kinds, status, source, manifest, checksum, report, verified_at)
        VALUES (@id, @name, @version, @engine, @kinds, @status, @source, @manifest, @checksum, @report, @verified_at)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, version=excluded.version, engine=excluded.engine, kinds=excluded.kinds,
          status=excluded.status, source=excluded.source, manifest=excluded.manifest,
          checksum=excluded.checksum, report=excluded.report, verified_at=excluded.verified_at`),
      deleteLayout: p('DELETE FROM layouts WHERE id = ?'),

      // Variant rules
      getVariantRules: p('SELECT tag, mode FROM variant_rules WHERE variant_id = ?'),
      clearVariantRules: p('DELETE FROM variant_rules WHERE variant_id = ?'),
      insertVariantRule: p('INSERT OR IGNORE INTO variant_rules (variant_id, tag, mode) VALUES (?, ?, ?)'),

      // Variant sections
      getVariantSections: p('SELECT section_id, enabled, sort_order FROM variant_sections WHERE variant_id = ? ORDER BY sort_order, section_id'),
      clearVariantSections: p('DELETE FROM variant_sections WHERE variant_id = ?'),
      insertVariantSection: p('INSERT OR IGNORE INTO variant_sections (variant_id, section_id, enabled, sort_order) VALUES (?, ?, ?, ?)'),

      // Overrides
      getEntryOverrides: p('SELECT entry_id, included, text_override, sort_override FROM entry_overrides WHERE variant_id = ?'),
      upsertEntryOverride: p('INSERT INTO entry_overrides (variant_id, entry_id, included, text_override, sort_override) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, entry_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override'),
      deleteEntryOverride: p('DELETE FROM entry_overrides WHERE variant_id = ? AND entry_id = ?'),
      getItemOverrides: p('SELECT item_id, included, text_override, sort_override FROM item_overrides WHERE variant_id = ?'),
      upsertItemOverride: p('INSERT INTO item_overrides (variant_id, item_id, included, text_override, sort_override) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, item_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override'),
      deleteItemOverride: p('DELETE FROM item_overrides WHERE variant_id = ? AND item_id = ?'),

      // Variant letter sections
      getLetterSections: p('SELECT id, sort_order, title, body FROM variant_letter_sections WHERE variant_id = ? ORDER BY sort_order, id'),
      insertLetterSection: p('INSERT INTO variant_letter_sections (variant_id, sort_order, title, body) VALUES (?, ?, ?, ?)'),
      updateLetterSection: p('UPDATE variant_letter_sections SET title = ?, body = ? WHERE id = ?'),
      deleteLetterSection: p('DELETE FROM variant_letter_sections WHERE id = ?'),
      updateLetterSectionOrder: p('UPDATE variant_letter_sections SET sort_order = ? WHERE id = ?'),
      maxLetterSectionOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM variant_letter_sections WHERE variant_id = ?'),
    };
  }

  // Settings methods (global + per-person) are mixed in from ./db/settings.js.

  // ---------------------------------------------------------------------------
  // Persons
  // ---------------------------------------------------------------------------

  getPersons() {
    return this._stmts.getPersons.all();
  }

  getPerson(id) {
    return this._stmts.getPerson.get(id) || null;
  }

  createPerson(name) {
    return this._stmts.insertPerson.run(name).lastInsertRowid;
  }

  renamePerson(id, name) {
    this._stmts.updatePersonName.run(name, id);
  }

  deletePerson(id) {
    // Cascades to person_settings, sections→entries→items→tags, variants→rules/overrides/sections/letters.
    this._stmts.deletePerson.run(id);
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  getSections(personId) {
    return this._stmts.getSectionsByPerson.all(personId).map(rowToSection);
  }

  /** Section with full entries→items→tags. */
  getSection(id) {
    const s = this._stmts.getSection.get(id);
    if (!s) return null;
    return { ...rowToSection(s), entries: this._entriesForSection(id) };
  }

  _entriesForSection(sectionId) {
    return this._stmts.getEntries.all(sectionId).map((e) => ({
      id: e.id,
      sectionId: e.section_id,
      sortOrder: e.sort_order,
      fields: JSON.parse(e.fields),
      tags: this._stmts.getEntryTags.all(e.id).map((r) => r.tag),
      items: this._stmts.getItems.all(e.id).map((i) => ({
        id: i.id,
        entryId: i.entry_id,
        sortOrder: i.sort_order,
        content: i.content,
        title: i.title,
        tags: this._stmts.getItemTags.all(i.id).map((r) => r.tag),
      })),
    }));
  }

  createSection(personId, slug, type, title = '') {
    const order = this._stmts.maxSectionSortOrder.get(personId).m + 1;
    return this._stmts.insertSection.run(personId, slug, normalizeType(type), title, order).lastInsertRowid;
  }

  updateSection(id, { slug, type, title }) {
    const cur = this._stmts.getSection.get(id);
    if (!cur) return;
    if (slug !== undefined || type !== undefined) {
      this._stmts.updateSectionSlugType.run(
        slug ?? cur.slug,
        type !== undefined ? normalizeType(type) : cur.type,
        title ?? cur.title,
        id
      );
    } else if (title !== undefined) {
      this._stmts.updateSectionTitle.run(title, id);
    }
  }

  deleteSection(id) {
    this._stmts.deleteSection.run(id);
  }

  reorderSections(personId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateSectionSortOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  getEntry(id) {
    const e = this._stmts.getEntry.get(id);
    if (!e) return null;
    return {
      id: e.id,
      sectionId: e.section_id,
      sortOrder: e.sort_order,
      fields: JSON.parse(e.fields),
      tags: this._stmts.getEntryTags.all(e.id).map((r) => r.tag),
      items: this._stmts.getItems.all(e.id).map((i) => ({
        id: i.id, entryId: i.entry_id, sortOrder: i.sort_order, content: i.content, title: i.title,
        tags: this._stmts.getItemTags.all(i.id).map((r) => r.tag),
      })),
    };
  }

  createEntry(sectionId, fields) {
    const order = this._stmts.maxEntrySortOrder.get(sectionId).m + 1;
    return this._stmts.insertEntry.run(sectionId, order, JSON.stringify(fields || {})).lastInsertRowid;
  }

  updateEntry(id, { fields }) {
    if (fields !== undefined) this._stmts.updateEntryFields.run(JSON.stringify(fields), id);
  }

  deleteEntry(id) {
    this._stmts.deleteEntry.run(id);
  }

  reorderEntries(sectionId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateEntrySortOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  createItem(entryId, content, title = '') {
    const order = this._stmts.maxItemSortOrder.get(entryId).m + 1;
    return this._stmts.insertItem.run(entryId, order, content, title).lastInsertRowid;
  }

  updateItem(id, { content, title }) {
    const tx = this.db.transaction(() => {
      if (content !== undefined) this._stmts.updateItemContent.run(content, id);
      if (title !== undefined) this._stmts.updateItemTitle.run(title, id);
    });
    tx();
  }

  deleteItem(id) {
    this._stmts.deleteItem.run(id);
  }

  reorderItems(entryId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateItemSortOrder.run(i, ids[i]);
    });
    tx();
  }

  // Tag subsystem (tags / aliases / catalog / suggestion) lives in ./db/tags.js.

  // Variant subsystem (CRUD / rules / sections / overrides / letters / resolution)
  // lives in ./db/variants.js.

  // ---------------------------------------------------------------------------
  // Aggregate read for MCP / UI — full master + variant summaries
  // ---------------------------------------------------------------------------

  getMaster(personId) {
    const person = this.getPerson(personId);
    if (!person) return null;
    return {
      person,
      personal: this.getPersonal(personId),
      coverletter: this.getCoverletterHeader(personId),
      sections: this.getSections(personId).map((s) => this.getSection(s.id)),
      variants: this.getVariants(personId).map((v) => ({
        ...v,
        rules: this.getVariantRules(v.id),
        sections: this.getVariantSections(v.id),
      })),
      tags: this.listTags(personId),
      tagAliases: this.getTagAliases(personId),
      tagCatalog: this.getTagCatalog(personId),
    };
  }

  // Export / import / seeding lives in ./db/import-export.js.

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close() {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row / shape helpers
// ---------------------------------------------------------------------------

// Row / shape / text helpers now live in ./db/helpers.js (imported at the top).

// Method clusters live in lib/db/ and are mixed onto the prototype here so the
// public surface (and getDb()) is unchanged. Settings is extracted; the larger
// clusters (tags, variants, import/export) follow this same pattern.
Object.assign(CvDatabase.prototype, require('./db/settings'));
applyMixin(CvDatabase, require('./db/tags'));
applyMixin(CvDatabase, require('./db/variants'));
applyMixin(CvDatabase, require('./db/layouts'));
applyMixin(CvDatabase, require('./db/import-export'));

module.exports = CvDatabase;
