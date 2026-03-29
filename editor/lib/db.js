/**
 * SQLite access layer for the CV Editor.
 *
 * Thin wrapper around better-sqlite3 with prepared statements.
 * All methods are synchronous (better-sqlite3 is sync by design).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

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
  }

  // ---------------------------------------------------------------------------
  // Migrations
  // ---------------------------------------------------------------------------

  _runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = new Set(
      this.db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    }
  }

  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  _prepareStatements() {
    this._stmts = {
      // Settings
      getSettings: this.db.prepare('SELECT key, value FROM settings WHERE key LIKE ? || \'%\''),
      getAllSettings: this.db.prepare('SELECT key, value FROM settings'),
      upsertSetting: this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),

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
      getItems: this.db.prepare('SELECT id, entry_id, sort_order, content, resume_included FROM items WHERE entry_id = ? ORDER BY sort_order'),
      getItem: this.db.prepare('SELECT id, entry_id, sort_order, content, resume_included FROM items WHERE id = ?'),
      insertItem: this.db.prepare('INSERT INTO items (entry_id, sort_order, content, resume_included) VALUES (?, ?, ?, ?)'),
      updateItemContent: this.db.prepare('UPDATE items SET content = ? WHERE id = ?'),
      updateItemResumeIncluded: this.db.prepare('UPDATE items SET resume_included = ? WHERE id = ?'),
      updateItemSortOrder: this.db.prepare('UPDATE items SET sort_order = ? WHERE id = ?'),
      deleteItem: this.db.prepare('DELETE FROM items WHERE id = ?'),
      maxItemSortOrder: this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM items WHERE entry_id = ?'),

      // Metrics
      getMetrics: this.db.prepare('SELECT id, command, label, value, group_name, section_id FROM metrics ORDER BY id'),
      getMetricsBySection: this.db.prepare('SELECT id, command, label, value, group_name, section_id FROM metrics WHERE section_id = ? ORDER BY id'),
      getMetric: this.db.prepare('SELECT id, command, label, value, group_name, section_id FROM metrics WHERE id = ?'),
      insertMetric: this.db.prepare('INSERT INTO metrics (command, label, value, group_name, section_id) VALUES (?, ?, ?, ?, ?)'),
      updateMetric: this.db.prepare('UPDATE metrics SET command = ?, label = ?, value = ?, group_name = ? WHERE id = ?'),
      deleteMetric: this.db.prepare('DELETE FROM metrics WHERE id = ?'),

      // Document sections
      getDocumentSections: this.db.prepare('SELECT section_id, enabled, sort_order, resume_paragraph_text FROM document_sections WHERE variant = ? ORDER BY sort_order'),
      clearDocumentSections: this.db.prepare('DELETE FROM document_sections WHERE variant = ?'),
      insertDocumentSection: this.db.prepare('INSERT INTO document_sections (variant, section_id, enabled, sort_order, resume_paragraph_text) VALUES (?, ?, ?, ?, ?)'),

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
      result[row.key] = row.value;
    }
    return result;
  }

  setSettings(map) {
    const tx = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        this._stmts.upsertSetting.run(key, value);
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

  createItem(entryId, content, resumeIncluded = true) {
    const nextOrder = this._stmts.maxItemSortOrder.get(entryId).max_order + 1;
    const info = this._stmts.insertItem.run(entryId, nextOrder, content, resumeIncluded ? 1 : 0);
    return info.lastInsertRowid;
  }

  updateItem(id, { content, resumeIncluded }) {
    const tx = this.db.transaction(() => {
      if (content !== undefined) {
        this._stmts.updateItemContent.run(content, id);
      }
      if (resumeIncluded !== undefined) {
        this._stmts.updateItemResumeIncluded.run(resumeIncluded ? 1 : 0, id);
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
  // Metrics
  // ---------------------------------------------------------------------------

  getMetrics(sectionId) {
    const rows = sectionId
      ? this._stmts.getMetricsBySection.all(sectionId)
      : this._stmts.getMetrics.all();
    return rows.map(r => ({
      id: r.id,
      command: r.command,
      label: r.label,
      value: r.value,
      groupName: r.group_name,
      sectionId: r.section_id,
    }));
  }

  createMetric({ command, label, value, groupName, sectionId }) {
    const info = this._stmts.insertMetric.run(command, label || '', value ?? null, groupName || '', sectionId);
    return info.lastInsertRowid;
  }

  updateMetric(id, { command, label, value, groupName }) {
    this._stmts.updateMetric.run(command, label, value ?? null, groupName, id);
  }

  deleteMetric(id) {
    this._stmts.deleteMetric.run(id);
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

      // All metrics
      const metrics = this.getMetrics();

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

      return { personal, metrics, sections, coverletter, variant };
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
      const metrics = this.getMetrics();

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

      return { personal, sections: allSections, metrics, documents, coverletter };
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
