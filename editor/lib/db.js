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

const JANE_DOE_DATA = {
  personal: {
    firstName: 'Jane', lastName: 'Doe',
    position: 'Senior Software Engineer',
    address: '123 Main Street, Anytown, ST 12345',
    mobile: '(555) 123-4567', email: 'jane.doe@example.com',
    github: 'janedoe', linkedin: 'janedoe',
    quote: 'Building the future, one commit at a time.',
    photoEnabled: '0', photoFile: '',
  },
  sections: [
    {
      id: 'summary', type: 'cvparagraph', title: 'Summary',
      entries: [{ id: 1, section_id: 'summary', sort_order: 0, resumeIncluded: true,
        fields: { text: 'Experienced software engineer with over 6 years of experience building scalable web applications and distributed systems. Passionate about clean code, mentoring, and continuous learning.' },
        items: [] }]
    },
    {
      id: 'experience', type: 'cventries', title: 'Experience',
      entries: [
        { id: 2, section_id: 'experience', sort_order: 0, resumeIncluded: true,
          fields: { position: 'Senior Software Engineer', organization: 'Acme Technologies', location: 'San Francisco, CA', date: '2022 -- Present' },
          items: [
            { id: 1, entry_id: 2, sort_order: 0, content: 'Led migration of monolithic architecture to microservices, reducing deployment time by 60\\%', resumeIncluded: true },
            { id: 2, entry_id: 2, sort_order: 1, content: 'Mentored team of 4 junior engineers through code reviews and pair programming sessions', resumeIncluded: true },
          ]
        },
        { id: 3, section_id: 'experience', sort_order: 1, resumeIncluded: true,
          fields: { position: 'Software Engineer', organization: 'Widget Corp', location: 'Austin, TX', date: '2019 -- 2022' },
          items: [
            { id: 3, entry_id: 3, sort_order: 0, content: 'Designed and implemented RESTful API serving 10,000 requests per second', resumeIncluded: true },
            { id: 4, entry_id: 3, sort_order: 1, content: 'Developed automated testing pipeline reducing QA cycle from 2 weeks to 3 days', resumeIncluded: true },
          ]
        }
      ]
    },
    {
      id: 'education', type: 'cventries', title: 'Education',
      entries: [
        { id: 4, section_id: 'education', sort_order: 0, resumeIncluded: true,
          fields: { position: 'B.S. Computer Science', organization: 'State University', location: 'Anytown, ST', date: '2015 -- 2019' },
          items: [
            { id: 5, entry_id: 4, sort_order: 0, content: 'Graduated magna cum laude, GPA 3.8/4.0', resumeIncluded: true },
          ]
        }
      ]
    },
    {
      id: 'skills', type: 'cvskills', title: 'Skills',
      entries: [
        { id: 5, section_id: 'skills', sort_order: 0, resumeIncluded: true, fields: { category: 'Languages', skills: 'JavaScript, Python, Go, Rust, SQL' }, items: [] },
        { id: 6, section_id: 'skills', sort_order: 1, resumeIncluded: true, fields: { category: 'Frameworks', skills: 'React, Node.js, Express, Django' }, items: [] },
        { id: 7, section_id: 'skills', sort_order: 2, resumeIncluded: true, fields: { category: 'Tools', skills: 'Docker, Kubernetes, Git, CI/CD, AWS' }, items: [] },
      ]
    },
  ],
  metrics: [
    { id: 1, command: 'projectCount', label: 'Projects', value: '15', groupName: 'General', sectionId: 'experience' },
    { id: 2, command: 'yearsExperience', label: 'Years', value: '6', groupName: 'General', sectionId: 'experience' },
  ],
  documents: {
    cv: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: null },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'education', enabled: true, sortOrder: 2, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 3, resumeParagraphText: null },
    ],
    resume: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: 'Software engineer with 6 years of experience in web applications and distributed systems.' },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 2, resumeParagraphText: null },
    ]
  },
  coverletter: {
    recipientName: 'Hiring Manager',
    recipientAddress: '456 Corporate Ave, Business City, ST 67890',
    title: 'Application for Software Engineer Position',
    opening: 'Dear Hiring Manager,',
    closing: 'Sincerely,',
    enclosureLabel: 'Attached',
    enclosureContent: 'Resume, Portfolio',
    sections: [
      { id: 1, sort_order: 0, title: 'Introduction', body: 'I am writing to express my interest in the Software Engineer position at your company. With over six years of experience in building scalable systems, I am confident I would be a strong addition to your team.' },
      { id: 2, sort_order: 1, title: 'Experience', body: 'In my current role at Acme Technologies, I have led the migration of a monolithic application to a microservices architecture, resulting in significant improvements in deployment speed and system reliability.' },
    ]
  }
};

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

      // Persons
      getPersons: this.db.prepare('SELECT id, name, created_at FROM persons ORDER BY id'),
      getPerson: this.db.prepare('SELECT id, name, data, created_at FROM persons WHERE id = ?'),
      getPersonByName: this.db.prepare('SELECT id, name, data, created_at FROM persons WHERE name = ?'),
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
      this.db.exec('DELETE FROM metrics');
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
                  this.createItem(entryId, item.content, itemResumeIncl);
                }
              }
            }
          }
        }
      }

      // Metrics
      if (data.metrics) {
        for (const m of data.metrics) {
          this.createMetric({
            command: m.command,
            label: m.label || '',
            value: m.value ?? null,
            groupName: m.groupName || '',
            sectionId: m.sectionId,
          });
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
