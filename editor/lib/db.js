/**
 * SQLite access layer for the CV Editor.
 *
 * Thin wrapper around better-sqlite3 with prepared statements.
 * All methods are synchronous (better-sqlite3 is sync by design).
 */

const Database = require('better-sqlite3');
const runMigrations = require('./migration-runner');
const { JANE_DOE_DATA } = require('./seed-data');

class CvDatabase {
  /**
   * @param {string} dbPath - Path to SQLite file, or ':memory:' for tests
   */
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._runMigrations();
    this._prepareStatements();
    this.seedJaneDoe();
    this.resetToJaneDoe();
  }

  _runMigrations() {
    runMigrations(this.db);
  }

  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  _prepareStatements() {
    this._stmts = {
      // Settings
      getSettings: this.db.prepare('SELECT key, value, value_num, value_unit FROM settings WHERE key LIKE ? || \'%\''),
      getAllSettings: this.db.prepare('SELECT key, value, value_num, value_unit FROM settings'),
      upsertSetting: this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      upsertSettingWithUnit: this.db.prepare('INSERT INTO settings (key, value, value_num, value_unit) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_num = excluded.value_num, value_unit = excluded.value_unit'),

      // Sections
      getSections: this.db.prepare('SELECT id, type, title FROM sections ORDER BY id'),
      getSection: this.db.prepare('SELECT id, type, title FROM sections WHERE id = ?'),
      insertSection: this.db.prepare('INSERT INTO sections (id, type, title) VALUES (?, ?, ?)'),
      updateSection: this.db.prepare('UPDATE sections SET title = ? WHERE id = ?'),
      deleteSection: this.db.prepare('DELETE FROM sections WHERE id = ?'),

      // Entries
      getEntries: this.db.prepare('SELECT id, section_id, sort_order, fields, resume_included FROM entries WHERE section_id = ? ORDER BY sort_order'),
      getEntry: this.db.prepare('SELECT id, section_id, sort_order, fields, resume_included FROM entries WHERE id = ?'),
      insertEntry: this.db.prepare('INSERT INTO entries (section_id, sort_order, fields, resume_included) VALUES (?, ?, ?, ?)'),
      updateEntryFields: this.db.prepare('UPDATE entries SET fields = ? WHERE id = ?'),
      updateEntryResumeIncluded: this.db.prepare('UPDATE entries SET resume_included = ? WHERE id = ?'),
      updateEntrySortOrder: this.db.prepare('UPDATE entries SET sort_order = ? WHERE id = ?'),
      deleteEntry: this.db.prepare('DELETE FROM entries WHERE id = ?'),
      maxEntrySortOrder: this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM entries WHERE section_id = ?'),

      // Items
      getItems: this.db.prepare('SELECT id, entry_id, sort_order, content, resume_included, title FROM items WHERE entry_id = ? ORDER BY sort_order'),
      getItem: this.db.prepare('SELECT id, entry_id, sort_order, content, resume_included, title FROM items WHERE id = ?'),
      insertItem: this.db.prepare('INSERT INTO items (entry_id, sort_order, content, resume_included, title) VALUES (?, ?, ?, ?, ?)'),
      updateItemContent: this.db.prepare('UPDATE items SET content = ? WHERE id = ?'),
      updateItemTitle: this.db.prepare('UPDATE items SET title = ? WHERE id = ?'),
      updateItemResumeIncluded: this.db.prepare('UPDATE items SET resume_included = ? WHERE id = ?'),
      updateItemSortOrder: this.db.prepare('UPDATE items SET sort_order = ? WHERE id = ?'),
      deleteItem: this.db.prepare('DELETE FROM items WHERE id = ?'),
      maxItemSortOrder: this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM items WHERE entry_id = ?'),

      // Document sections
      getDocumentSections: this.db.prepare('SELECT section_id, enabled, sort_order, resume_paragraph_text FROM document_sections WHERE variant = ? ORDER BY sort_order'),
      clearDocumentSections: this.db.prepare('DELETE FROM document_sections WHERE variant = ?'),
      insertDocumentSection: this.db.prepare('INSERT INTO document_sections (variant, section_id, enabled, sort_order, resume_paragraph_text) VALUES (?, ?, ?, ?, ?)'),

      // Persons
      getPersons: this.db.prepare('SELECT id, name, created_at FROM persons ORDER BY id'),
      getPerson: this.db.prepare('SELECT id, name, data, created_at FROM persons WHERE id = ?'),
      insertPerson: this.db.prepare('INSERT INTO persons (name, data) VALUES (?, ?)'),
      updatePersonName: this.db.prepare('UPDATE persons SET name = ? WHERE id = ?'),
      updatePersonData: this.db.prepare('UPDATE persons SET data = ? WHERE id = ?'),
      deletePerson: this.db.prepare('DELETE FROM persons WHERE id = ?'),
      countPersons: this.db.prepare('SELECT COUNT(*) AS cnt FROM persons'),

      // Coverletter sections
      getCoverletterSections: this.db.prepare('SELECT id, sort_order, title, body FROM coverletter_sections ORDER BY sort_order'),
      getCoverletterSection: this.db.prepare('SELECT id, sort_order, title, body FROM coverletter_sections WHERE id = ?'),
      insertCoverletterSection: this.db.prepare('INSERT INTO coverletter_sections (sort_order, title, body) VALUES (?, ?, ?)'),
      updateCoverletterSection: this.db.prepare('UPDATE coverletter_sections SET title = ?, body = ? WHERE id = ?'),
      deleteCoverletterSection: this.db.prepare('DELETE FROM coverletter_sections WHERE id = ?'),
      updateCoverletterSectionOrder: this.db.prepare('UPDATE coverletter_sections SET sort_order = ? WHERE id = ?'),
      maxCoverletterSectionOrder: this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM coverletter_sections'),
    };
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  getSettings(prefix) {
    const rows = prefix
      ? this._stmts.getSettings.all(prefix + '.')
      : this._stmts.getAllSettings.all();
    const result = {};
    for (const row of rows) {
      if (row.value_num != null && row.value_unit != null) {
        result[row.key] = { num: row.value_num, unit: row.value_unit };
      } else {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  setSettings(map) {
    const tx = this.db.transaction((entries) => {
      for (const [key, val] of entries) {
        if (val && typeof val === 'object' && 'num' in val && 'unit' in val) {
          this._stmts.upsertSettingWithUnit.run(key, String(val.num) + val.unit, val.num, val.unit);
        } else {
          this._stmts.upsertSetting.run(key, val);
        }
      }
    });
    tx(Object.entries(map));
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  getSections() {
    return this._stmts.getSections.all();
  }

  getSection(id) {
    const section = this._stmts.getSection.get(id);
    if (!section) return null;

    const entries = this._stmts.getEntries.all(id).map(e => ({
      ...e,
      fields: JSON.parse(e.fields),
      resumeIncluded: !!e.resume_included,
      items: this._stmts.getItems.all(e.id).map(i => ({
        ...i,
        resumeIncluded: !!i.resume_included,
      })),
    }));

    return { ...section, entries };
  }

  createSection(id, type, title) {
    this._stmts.insertSection.run(id, type, title);
  }

  updateSection(id, { title }) {
    this._stmts.updateSection.run(title, id);
  }

  deleteSection(id) {
    this._stmts.deleteSection.run(id);
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  getEntries(sectionId) {
    return this._stmts.getEntries.all(sectionId).map(e => ({
      ...e,
      fields: JSON.parse(e.fields),
      resumeIncluded: !!e.resume_included,
      items: this._stmts.getItems.all(e.id).map(i => ({
        ...i,
        resumeIncluded: !!i.resume_included,
      })),
    }));
  }

  createEntry(sectionId, fields, resumeIncluded = true) {
    const nextOrder = this._stmts.maxEntrySortOrder.get(sectionId).max_order + 1;
    const info = this._stmts.insertEntry.run(sectionId, nextOrder, JSON.stringify(fields), resumeIncluded ? 1 : 0);
    return info.lastInsertRowid;
  }

  updateEntry(id, { fields, resumeIncluded }) {
    const tx = this.db.transaction(() => {
      if (fields !== undefined) {
        this._stmts.updateEntryFields.run(JSON.stringify(fields), id);
      }
      if (resumeIncluded !== undefined) {
        this._stmts.updateEntryResumeIncluded.run(resumeIncluded ? 1 : 0, id);
      }
    });
    tx();
  }

  deleteEntry(id) {
    this._stmts.deleteEntry.run(id);
  }

  reorderEntries(sectionId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        this._stmts.updateEntrySortOrder.run(i, ids[i]);
      }
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  createItem(entryId, content, resumeIncluded = true, title = '') {
    const nextOrder = this._stmts.maxItemSortOrder.get(entryId).max_order + 1;
    const info = this._stmts.insertItem.run(entryId, nextOrder, content, resumeIncluded ? 1 : 0, title);
    return info.lastInsertRowid;
  }

  updateItem(id, { content, resumeIncluded, title }) {
    const tx = this.db.transaction(() => {
      if (content !== undefined) {
        this._stmts.updateItemContent.run(content, id);
      }
      if (resumeIncluded !== undefined) {
        this._stmts.updateItemResumeIncluded.run(resumeIncluded ? 1 : 0, id);
      }
      if (title !== undefined) {
        this._stmts.updateItemTitle.run(title, id);
      }
    });
    tx();
  }

  deleteItem(id) {
    this._stmts.deleteItem.run(id);
  }

  reorderItems(entryId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        this._stmts.updateItemSortOrder.run(i, ids[i]);
      }
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Document sections
  // ---------------------------------------------------------------------------

  getDocumentSections(variant) {
    return this._stmts.getDocumentSections.all(variant).map(r => ({
      sectionId: r.section_id,
      enabled: !!r.enabled,
      sortOrder: r.sort_order,
      resumeParagraphText: r.resume_paragraph_text,
    }));
  }

  setDocumentSections(variant, sections) {
    const tx = this.db.transaction(() => {
      this._stmts.clearDocumentSections.run(variant);
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        this._stmts.insertDocumentSection.run(
          variant,
          s.sectionId,
          s.enabled !== false ? 1 : 0,
          i,
          s.resumeParagraphText ?? null
        );
      }
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Cover letter sections
  // ---------------------------------------------------------------------------

  getCoverletterSections() {
    return this._stmts.getCoverletterSections.all();
  }

  createCoverletterSection(title, body) {
    const nextOrder = this._stmts.maxCoverletterSectionOrder.get().max_order + 1;
    const info = this._stmts.insertCoverletterSection.run(nextOrder, title, body);
    return info.lastInsertRowid;
  }

  updateCoverletterSection(id, { title, body }) {
    this._stmts.updateCoverletterSection.run(title, body, id);
  }

  deleteCoverletterSection(id) {
    this._stmts.deleteCoverletterSection.run(id);
  }

  reorderCoverletterSections(ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        this._stmts.updateCoverletterSectionOrder.run(i, ids[i]);
      }
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Persons
  // ---------------------------------------------------------------------------

  getPersons() {
    return this._stmts.getPersons.all();
  }

  getPerson(id) {
    const row = this._stmts.getPerson.get(id);
    if (!row) return null;
    return { id: row.id, name: row.name, data: JSON.parse(row.data), created_at: row.created_at };
  }

  createPerson(name, data = {}) {
    const info = this._stmts.insertPerson.run(name, JSON.stringify(data));
    return info.lastInsertRowid;
  }

  renamePerson(id, name) {
    this._stmts.updatePersonName.run(name, id);
  }

  deletePerson(id) {
    const activeId = this.getActivePersonId();
    if (activeId === id) {
      throw new Error('Cannot delete the active person');
    }
    this._stmts.deletePerson.run(id);
  }

  getActivePersonId() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = '_active_person_id'").get();
    return row ? parseInt(row.value, 10) : null;
  }

  setActivePersonId(id) {
    this._stmts.upsertSetting.run('_active_person_id', String(id));
  }

  clearAllContent() {
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM coverletter_sections');
      this.db.exec('DELETE FROM document_sections');
      this.db.exec('DELETE FROM items');
      this.db.exec('DELETE FROM entries');
      this.db.exec('DELETE FROM sections');
      this.db.exec("DELETE FROM settings WHERE key != '_active_person_id'");
    });
    tx();
  }

  importAll(data) {
    const tx = this.db.transaction(() => {
      this.clearAllContent();

      // Settings: personal
      if (data.personal) {
        const personalSettings = {};
        for (const [key, value] of Object.entries(data.personal)) {
          personalSettings['personal.' + key] = value;
        }
        this.setSettings(personalSettings);
      }

      // Settings: coverletter (excluding sections array)
      if (data.coverletter) {
        const clSettings = {};
        for (const [key, value] of Object.entries(data.coverletter)) {
          if (key === 'sections') continue;
          clSettings['coverletter.' + key] = value;
        }
        this.setSettings(clSettings);
      }

      // Sections with entries and items
      if (data.sections) {
        for (const sec of data.sections) {
          this.createSection(sec.id, sec.type, sec.title);
          if (sec.entries) {
            for (let ei = 0; ei < sec.entries.length; ei++) {
              const entry = sec.entries[ei];
              const resumeIncl = entry.resumeIncluded !== undefined ? entry.resumeIncluded : true;
              const entryId = this.createEntry(sec.id, entry.fields, resumeIncl);
              if (entry.items) {
                for (const item of entry.items) {
                  const itemResumeIncl = item.resumeIncluded !== undefined ? item.resumeIncluded : true;
                  this.createItem(entryId, item.content, itemResumeIncl, item.title || '');
                }
              }
            }
          }
        }
      }

      // Document sections
      if (data.documents) {
        for (const [variant, sections] of Object.entries(data.documents)) {
          this.setDocumentSections(variant, sections);
        }
      }

      // Cover letter sections
      if (data.coverletter && data.coverletter.sections) {
        for (const sec of data.coverletter.sections) {
          this.createCoverletterSection(sec.title, sec.body);
        }
      }
    });
    tx();
  }

  savePerson(id) {
    const exportData = this.getAllForExport();
    this._stmts.updatePersonData.run(JSON.stringify(exportData), id);
  }

  switchPerson(newId) {
    const tx = this.db.transaction(() => {
      const currentId = this.getActivePersonId();
      if (currentId) {
        this.savePerson(currentId);
      }
      const person = this.getPerson(newId);
      if (!person) throw new Error('Person not found');
      // Only import if data is non-empty
      if (person.data && Object.keys(person.data).length > 0) {
        this.importAll(person.data);
      } else {
        this.clearAllContent();
      }
      this.setActivePersonId(newId);
    });
    tx();
  }

  resetToJaneDoe() {
    const persons = this.getPersons();
    const jane = persons.find(p => p.name === 'Jane Doe');
    if (!jane) return;
    const activeId = this.getActivePersonId();
    if (activeId === jane.id) return;
    this.switchPerson(jane.id);
  }

  seedJaneDoe() {
    const count = this._stmts.countPersons.get().cnt;
    if (count > 0) return; // Already has persons, skip seeding

    // If content tables have data (existing user data), save it as a person first
    const existingSections = this.getSections();
    if (existingSections.length > 0) {
      const existingData = this.getAllForExport();
      const existingId = this.createPerson('My Data', existingData);
      this.setActivePersonId(existingId);
    }

    // Create Jane Doe
    const janeId = this.createPerson('Jane Doe', JANE_DOE_DATA);

    // If no active person yet, load Jane's data
    if (!this.getActivePersonId()) {
      this.importAll(JANE_DOE_DATA);
      this.setActivePersonId(janeId);
    }
  }

  // ---------------------------------------------------------------------------
  // Compound reads
  // ---------------------------------------------------------------------------

  /**
   * Returns everything needed to generate .tex files for a document variant.
   * Runs in a single read transaction for consistency.
   */
  getAllForCompile(variant) {
    return this.db.transaction(() => {
      // Personal info
      const personalSettings = this.getSettings('personal');
      const personal = {};
      for (const [key, value] of Object.entries(personalSettings)) {
        const field = key.replace('personal.', '');
        personal[field] = value;
      }

      // Document section ordering
      const docSections = this.getDocumentSections(variant);

      // Full section data for each included section
      const sections = [];
      for (const ds of docSections) {
        if (!ds.enabled) continue;
        const section = this.getSection(ds.sectionId);
        if (!section) continue;

        // For resume variant, filter out excluded entries and items
        if (variant === 'resume') {
          section.entries = section.entries
            .filter(e => e.resumeIncluded)
            .map(e => ({
              ...e,
              items: e.items.filter(i => i.resumeIncluded),
            }));

          // Use resume paragraph text override if available
          if (section.type === 'cvparagraph' && ds.resumeParagraphText) {
            if (section.entries.length > 0) {
              section.entries[0].fields = { ...section.entries[0].fields, text: ds.resumeParagraphText };
            }
          }
        }

        sections.push({ ...section, sortOrder: ds.sortOrder });
      }

      // Cover letter data (only for coverletter variant)
      let coverletter = null;
      if (variant === 'coverletter') {
        const clSettings = this.getSettings('coverletter');
        const cl = {};
        for (const [key, value] of Object.entries(clSettings)) {
          const field = key.replace('coverletter.', '');
          cl[field] = value;
        }
        cl.sections = this.getCoverletterSections();
        coverletter = cl;
      }

      // Style settings
      const styleSettings = this.getSettings('style');
      const style = {};
      for (const [key, value] of Object.entries(styleSettings)) {
        style[key.replace('style.', '')] = value;
      }

      // Spacing settings — reconstruct combined strings for generator
      const spacingSettings = this.getSettings('spacing');
      const spacing = {};
      for (const [key, val] of Object.entries(spacingSettings)) {
        const field = key.replace('spacing.', '');
        spacing[field] = (val && typeof val === 'object') ? String(val.num) + val.unit : val;
      }

      // Font size settings — reconstruct combined strings for generator
      const fontsSettings = this.getSettings('fonts');
      const fonts = {};
      for (const [key, val] of Object.entries(fontsSettings)) {
        const field = key.replace('fonts.', '');
        fonts[field] = (val && typeof val === 'object') ? String(val.num) + val.unit : val;
      }

      return { personal, sections, coverletter, variant, style, spacing, fonts };
    })();
  }

  /**
   * Full JSON export of all data (for website about page / backup).
   */
  getAllForExport() {
    return this.db.transaction(() => {
      const personalSettings = this.getSettings('personal');
      const personal = {};
      for (const [key, value] of Object.entries(personalSettings)) {
        personal[key.replace('personal.', '')] = value;
      }

      const allSections = this.getSections().map(s => this.getSection(s.id));

      const documents = {};
      for (const variant of ['cv', 'resume']) {
        documents[variant] = this.getDocumentSections(variant);
      }

      const clSettings = this.getSettings('coverletter');
      const coverletter = {};
      for (const [key, value] of Object.entries(clSettings)) {
        coverletter[key.replace('coverletter.', '')] = value;
      }
      coverletter.sections = this.getCoverletterSections();

      return { personal, sections: allSections, documents, coverletter };
    })();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close() {
    this.db.close();
  }
}

module.exports = CvDatabase;
