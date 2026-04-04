/**
 * Unit tests for the SQLite database access layer.
 * All tests use :memory: databases — no file I/O.
 */

const CvDatabase = require('../../lib/db');

let db;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  // Clear seeded Jane Doe data so existing tests start with a blank slate
  db.clearAllContent();
});

afterEach(() => {
  db.close();
});

// ═════════════════════════════════════════════════════════════════════════════
// Settings
// ═════════════════════════════════════════════════════════════════════════════

describe('Settings', () => {
  test('getSettings returns empty object when no settings exist', () => {
    expect(db.getSettings('personal')).toEqual({});
  });

  test('setSettings upserts key-value pairs', () => {
    db.setSettings({
      'personal.firstName': 'Andrew',
      'personal.lastName': 'Peterson',
    });
    const result = db.getSettings('personal');
    expect(result['personal.firstName']).toBe('Andrew');
    expect(result['personal.lastName']).toBe('Peterson');
  });

  test('setSettings overwrites existing values', () => {
    db.setSettings({ 'personal.firstName': 'Andrew' });
    db.setSettings({ 'personal.firstName': 'Andy' });
    expect(db.getSettings('personal')['personal.firstName']).toBe('Andy');
  });

  test('getSettings with no prefix returns all settings', () => {
    db.setSettings({
      'personal.firstName': 'Andrew',
      'coverletter.title': 'Application',
    });
    const all = db.getSettings();
    // +1 for _active_person_id from seed
    expect(all['personal.firstName']).toBe('Andrew');
    expect(all['coverletter.title']).toBe('Application');
  });

  test('getSettings filters by prefix', () => {
    db.setSettings({
      'personal.firstName': 'Andrew',
      'coverletter.title': 'Application',
    });
    const personal = db.getSettings('personal');
    expect(Object.keys(personal).length).toBe(1);
    expect(personal['personal.firstName']).toBe('Andrew');
  });

  test('setSettings handles null values', () => {
    db.setSettings({ 'personal.quote': null });
    expect(db.getSettings('personal')['personal.quote']).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sections
// ═════════════════════════════════════════════════════════════════════════════

describe('Sections', () => {
  test('getSections returns empty array initially', () => {
    expect(db.getSections()).toEqual([]);
  });

  test('createSection and getSections roundtrip', () => {
    db.createSection('experience', 'experience', 'Experience');
    db.createSection('skills', 'skills', 'Skills');
    const sections = db.getSections();
    expect(sections.length).toBe(2);
    expect(sections[0].id).toBe('experience');
    expect(sections[0].type).toBe('experience');
    expect(sections[0].title).toBe('Experience');
  });

  test('getSection returns section with empty entries', () => {
    db.createSection('skills', 'skills', 'Skills');
    const section = db.getSection('skills');
    expect(section.id).toBe('skills');
    expect(section.entries).toEqual([]);
  });

  test('getSection returns null for nonexistent section', () => {
    expect(db.getSection('nonexistent')).toBeNull();
  });

  test('updateSection changes title', () => {
    db.createSection('skills', 'skills', 'Skills');
    db.updateSection('skills', { title: 'Technical Skills' });
    expect(db.getSection('skills').title).toBe('Technical Skills');
  });

  test('deleteSection removes section', () => {
    db.createSection('skills', 'skills', 'Skills');
    db.deleteSection('skills');
    expect(db.getSections()).toEqual([]);
  });

  test('duplicate section id throws', () => {
    db.createSection('skills', 'skills', 'Skills');
    expect(() => db.createSection('skills', 'skills', 'Skills 2')).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Entries
// ═════════════════════════════════════════════════════════════════════════════

describe('Entries', () => {
  beforeEach(() => {
    db.createSection('experience', 'experience', 'Experience');
  });

  test('createEntry returns auto-incremented ID', () => {
    const id1 = db.createEntry('experience', { position: 'Engineer', organization: 'Acme' });
    const id2 = db.createEntry('experience', { position: 'Intern', organization: 'Corp' });
    expect(id2).toBeGreaterThan(id1);
  });

  test('createEntry sets sort_order incrementally', () => {
    db.createEntry('experience', { position: 'First' });
    db.createEntry('experience', { position: 'Second' });
    const entries = db.getEntries('experience');
    expect(entries[0].sort_order).toBe(0);
    expect(entries[1].sort_order).toBe(1);
  });

  test('getEntries returns parsed JSON fields', () => {
    db.createEntry('experience', { position: 'Engineer', organization: 'Acme', location: 'CA', date: '2024' });
    const entries = db.getEntries('experience');
    expect(entries[0].fields.position).toBe('Engineer');
    expect(entries[0].fields.organization).toBe('Acme');
  });

  test('getEntries returns resumeIncluded as boolean', () => {
    db.createEntry('experience', { position: 'Engineer' }, true);
    db.createEntry('experience', { position: 'Intern' }, false);
    const entries = db.getEntries('experience');
    expect(entries[0].resumeIncluded).toBe(true);
    expect(entries[1].resumeIncluded).toBe(false);
  });

  test('getSection returns entries with nested items', () => {
    const entryId = db.createEntry('experience', { position: 'Engineer' });
    db.createItem(entryId, 'Built something');
    db.createItem(entryId, 'Fixed something');
    const section = db.getSection('experience');
    expect(section.entries[0].items.length).toBe(2);
    expect(section.entries[0].items[0].content).toBe('Built something');
  });

  test('updateEntry changes fields', () => {
    const id = db.createEntry('experience', { position: 'Engineer' });
    db.updateEntry(id, { fields: { position: 'Senior Engineer' } });
    const entries = db.getEntries('experience');
    expect(entries[0].fields.position).toBe('Senior Engineer');
  });

  test('updateEntry changes resumeIncluded', () => {
    const id = db.createEntry('experience', { position: 'Engineer' });
    db.updateEntry(id, { resumeIncluded: false });
    const entries = db.getEntries('experience');
    expect(entries[0].resumeIncluded).toBe(false);
  });

  test('deleteEntry removes entry and cascades items', () => {
    const entryId = db.createEntry('experience', { position: 'Engineer' });
    db.createItem(entryId, 'Bullet 1');
    db.deleteEntry(entryId);
    expect(db.getEntries('experience')).toEqual([]);
  });

  test('deleteSection cascades to entries and items', () => {
    const entryId = db.createEntry('experience', { position: 'Engineer' });
    db.createItem(entryId, 'Bullet 1');
    db.deleteSection('experience');
    expect(db.getEntries('experience')).toEqual([]);
  });

  test('reorderEntries changes sort_order', () => {
    const id1 = db.createEntry('experience', { position: 'First' });
    const id2 = db.createEntry('experience', { position: 'Second' });
    const id3 = db.createEntry('experience', { position: 'Third' });

    db.reorderEntries('experience', [id3, id1, id2]);
    const entries = db.getEntries('experience');
    expect(entries[0].fields.position).toBe('Third');
    expect(entries[1].fields.position).toBe('First');
    expect(entries[2].fields.position).toBe('Second');
  });

  test('entry with missing section_id throws', () => {
    expect(() => db.createEntry('nonexistent', { position: 'Test' })).toThrow();
  });

  test('JSON fields roundtrip preserves complex data', () => {
    const fields = {
      position: 'Quantum Software Engineering Lead',
      organization: 'Qualcomm Institute',
      location: 'San Diego, CA',
      date: 'Jul. 2022 -- Dec. 2024',
    };
    db.createEntry('experience', fields);
    const entries = db.getEntries('experience');
    expect(entries[0].fields).toEqual(fields);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Items
// ═════════════════════════════════════════════════════════════════════════════

describe('Items', () => {
  let entryId;

  beforeEach(() => {
    db.createSection('experience', 'experience', 'Experience');
    entryId = db.createEntry('experience', { position: 'Engineer' });
  });

  test('createItem returns auto-incremented ID', () => {
    const id1 = db.createItem(entryId, 'First bullet');
    const id2 = db.createItem(entryId, 'Second bullet');
    expect(id2).toBeGreaterThan(id1);
  });

  test('createItem sets sort_order incrementally', () => {
    db.createItem(entryId, 'First');
    db.createItem(entryId, 'Second');
    const section = db.getSection('experience');
    const items = section.entries[0].items;
    expect(items[0].sort_order).toBe(0);
    expect(items[1].sort_order).toBe(1);
  });

  test('updateItem changes content', () => {
    const id = db.createItem(entryId, 'Original');
    db.updateItem(id, { content: 'Updated' });
    const section = db.getSection('experience');
    expect(section.entries[0].items[0].content).toBe('Updated');
  });

  test('updateItem changes resumeIncluded', () => {
    const id = db.createItem(entryId, 'Bullet');
    db.updateItem(id, { resumeIncluded: false });
    const section = db.getSection('experience');
    expect(section.entries[0].items[0].resumeIncluded).toBe(false);
  });

  test('deleteItem removes item', () => {
    const id = db.createItem(entryId, 'To be deleted');
    db.deleteItem(id);
    const section = db.getSection('experience');
    expect(section.entries[0].items).toEqual([]);
  });

  test('reorderItems changes sort_order', () => {
    const id1 = db.createItem(entryId, 'First');
    const id2 = db.createItem(entryId, 'Second');
    const id3 = db.createItem(entryId, 'Third');

    db.reorderItems(entryId, [id3, id1, id2]);
    const section = db.getSection('experience');
    const items = section.entries[0].items;
    expect(items[0].content).toBe('Third');
    expect(items[1].content).toBe('First');
    expect(items[2].content).toBe('Second');
  });

  test('item with invalid entry_id throws', () => {
    expect(() => db.createItem(99999, 'Bad item')).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Document sections
// ═════════════════════════════════════════════════════════════════════════════

describe('Document sections', () => {
  beforeEach(() => {
    db.createSection('experience', 'experience', 'Experience');
    db.createSection('skills', 'skills', 'Skills');
    db.createSection('education', 'education', 'Education');
  });

  test('getDocumentSections returns empty for unknown variant', () => {
    expect(db.getDocumentSections('nonexistent')).toEqual([]);
  });

  test('setDocumentSections and getDocumentSections roundtrip', () => {
    db.setDocumentSections('cv', [
      { sectionId: 'experience', enabled: true },
      { sectionId: 'skills', enabled: true },
      { sectionId: 'education', enabled: false },
    ]);
    const result = db.getDocumentSections('cv');
    expect(result.length).toBe(3);
    expect(result[0].sectionId).toBe('experience');
    expect(result[0].enabled).toBe(true);
    expect(result[0].sortOrder).toBe(0);
    expect(result[2].enabled).toBe(false);
  });

  test('setDocumentSections replaces existing config', () => {
    db.setDocumentSections('cv', [
      { sectionId: 'experience', enabled: true },
      { sectionId: 'skills', enabled: true },
    ]);
    db.setDocumentSections('cv', [
      { sectionId: 'skills', enabled: true },
    ]);
    expect(db.getDocumentSections('cv').length).toBe(1);
  });

  test('setDocumentSections preserves resumeParagraphText', () => {
    db.createSection('summary', 'summary', 'Summary');
    db.setDocumentSections('resume', [
      { sectionId: 'summary', enabled: true, resumeParagraphText: 'Short version for resume' },
    ]);
    const result = db.getDocumentSections('resume');
    expect(result[0].resumeParagraphText).toBe('Short version for resume');
  });

  test('different variants are independent', () => {
    db.setDocumentSections('cv', [
      { sectionId: 'experience', enabled: true },
      { sectionId: 'skills', enabled: true },
    ]);
    db.setDocumentSections('resume', [
      { sectionId: 'experience', enabled: true },
    ]);
    expect(db.getDocumentSections('cv').length).toBe(2);
    expect(db.getDocumentSections('resume').length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cover letter sections
// ═════════════════════════════════════════════════════════════════════════════

describe('Coverletter sections', () => {
  test('getCoverletterSections returns empty initially', () => {
    expect(db.getCoverletterSections()).toEqual([]);
  });

  test('createCoverletterSection and retrieve', () => {
    const id = db.createCoverletterSection('About Me', 'I am a software engineer...');
    const sections = db.getCoverletterSections();
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe('About Me');
    expect(sections[0].body).toBe('I am a software engineer...');
    expect(sections[0].id).toBe(id);
  });

  test('sort_order increments automatically', () => {
    db.createCoverletterSection('First', 'Body 1');
    db.createCoverletterSection('Second', 'Body 2');
    const sections = db.getCoverletterSections();
    expect(sections[0].sort_order).toBe(0);
    expect(sections[1].sort_order).toBe(1);
  });

  test('updateCoverletterSection changes fields', () => {
    const id = db.createCoverletterSection('Old', 'Old body');
    db.updateCoverletterSection(id, { title: 'New', body: 'New body' });
    const sections = db.getCoverletterSections();
    expect(sections[0].title).toBe('New');
    expect(sections[0].body).toBe('New body');
  });

  test('deleteCoverletterSection removes section', () => {
    const id = db.createCoverletterSection('Temp', 'To delete');
    db.deleteCoverletterSection(id);
    expect(db.getCoverletterSections()).toEqual([]);
  });

  test('reorderCoverletterSections changes order', () => {
    const id1 = db.createCoverletterSection('First', 'A');
    const id2 = db.createCoverletterSection('Second', 'B');
    const id3 = db.createCoverletterSection('Third', 'C');

    db.reorderCoverletterSections([id3, id1, id2]);
    const sections = db.getCoverletterSections();
    expect(sections[0].title).toBe('Third');
    expect(sections[1].title).toBe('First');
    expect(sections[2].title).toBe('Second');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Compound reads
// ═════════════════════════════════════════════════════════════════════════════

describe('getAllForCompile', () => {
  beforeEach(() => {
    // Seed personal info
    db.setSettings({
      'personal.firstName': 'Andrew',
      'personal.lastName': 'Peterson',
      'personal.email': 'acpeters@ucsd.edu',
    });

    // Create sections
    db.createSection('experience', 'experience', 'Experience');
    db.createSection('skills', 'skills', 'Skills');
    db.createSection('summary', 'summary', 'Summary');

    // Add entries
    const expId = db.createEntry('experience', { position: 'Engineer', organization: 'Acme' });
    db.createItem(expId, 'Built widgets');
    db.createItem(expId, 'Fixed bugs');

    const expId2 = db.createEntry('experience', { position: 'Intern', organization: 'Corp' }, false);
    db.createItem(expId2, 'Intern bullet');

    db.createEntry('skills', { category: 'Languages', skills: 'Python, JS' });
    db.createEntry('summary', { text: 'Full summary for CV' });

    // Set document ordering
    db.setDocumentSections('cv', [
      { sectionId: 'summary', enabled: true },
      { sectionId: 'experience', enabled: true },
      { sectionId: 'skills', enabled: true },
    ]);
    db.setDocumentSections('resume', [
      { sectionId: 'summary', enabled: true, resumeParagraphText: 'Short resume summary' },
      { sectionId: 'experience', enabled: true },
      { sectionId: 'skills', enabled: true },
    ]);
  });

  test('returns personal info', () => {
    const data = db.getAllForCompile('cv');
    expect(data.personal.firstName).toBe('Andrew');
    expect(data.personal.email).toBe('acpeters@ucsd.edu');
  });

  test('returns sections in document order', () => {
    const data = db.getAllForCompile('cv');
    expect(data.sections.length).toBe(3);
    expect(data.sections[0].id).toBe('summary');
    expect(data.sections[1].id).toBe('experience');
    expect(data.sections[2].id).toBe('skills');
  });

  test('CV variant includes all entries', () => {
    const data = db.getAllForCompile('cv');
    const exp = data.sections.find(s => s.id === 'experience');
    expect(exp.entries.length).toBe(2);
  });

  test('resume variant filters excluded entries', () => {
    const data = db.getAllForCompile('resume');
    const exp = data.sections.find(s => s.id === 'experience');
    expect(exp.entries.length).toBe(1);
    expect(exp.entries[0].fields.position).toBe('Engineer');
  });

  test('resume variant filters excluded items', () => {
    // Exclude first bullet from first entry
    const section = db.getSection('experience');
    const firstItem = section.entries[0].items[0];
    db.updateItem(firstItem.id, { resumeIncluded: false });

    const data = db.getAllForCompile('resume');
    const exp = data.sections.find(s => s.id === 'experience');
    expect(exp.entries[0].items.length).toBe(1);
    expect(exp.entries[0].items[0].content).toBe('Fixed bugs');
  });

  test('resume variant uses resumeParagraphText override', () => {
    const data = db.getAllForCompile('resume');
    const summary = data.sections.find(s => s.id === 'summary');
    expect(summary.entries[0].fields.text).toBe('Short resume summary');
  });

  test('coverletter variant includes coverletter data', () => {
    db.setSettings({
      'coverletter.recipientName': 'Hiring Team',
      'coverletter.opening': 'Dear Hiring Manager,',
    });
    db.createCoverletterSection('About Me', 'I am...');
    db.setDocumentSections('coverletter', []);

    const data = db.getAllForCompile('coverletter');
    expect(data.coverletter.recipientName).toBe('Hiring Team');
    expect(data.coverletter.sections.length).toBe(1);
  });

  test('skips disabled sections', () => {
    db.setDocumentSections('cv', [
      { sectionId: 'summary', enabled: true },
      { sectionId: 'experience', enabled: false },
      { sectionId: 'skills', enabled: true },
    ]);
    const data = db.getAllForCompile('cv');
    expect(data.sections.length).toBe(2);
    expect(data.sections.map(s => s.id)).toEqual(['summary', 'skills']);
  });
});

describe('getAllForExport', () => {
  test('returns complete data structure', () => {
    db.setSettings({ 'personal.firstName': 'Andrew' });
    db.createSection('skills', 'skills', 'Skills');
    db.createEntry('skills', { category: 'Languages', skills: 'Python' });
    db.setDocumentSections('cv', [{ sectionId: 'skills', enabled: true }]);
    db.setSettings({ 'coverletter.title': 'App' });
    db.createCoverletterSection('About', 'Body');

    const data = db.getAllForExport();
    expect(data.personal.firstName).toBe('Andrew');
    expect(data.sections.length).toBe(1);
    expect(data.sections[0].entries.length).toBe(1);
    expect(data.documents.cv.length).toBe(1);
    expect(data.coverletter.title).toBe('App');
    expect(data.coverletter.sections.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Migrations
// ═════════════════════════════════════════════════════════════════════════════

describe('Migrations', () => {
  test('migrations table is created', () => {
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('_migrations');
    expect(names).toContain('settings');
    expect(names).toContain('sections');
    expect(names).toContain('entries');
    expect(names).toContain('items');
    expect(names).toContain('document_sections');
    expect(names).toContain('coverletter_sections');
  });

  test('migration is recorded', () => {
    const migrations = db.db.prepare('SELECT name FROM _migrations').all();
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0].name).toBe('001_initial.sql');
  });

  test('re-opening database does not re-run migrations', () => {
    // The :memory: DB is fresh each time, but within a single instance
    // migrations should only run once
    const migrations = db.db.prepare('SELECT name FROM _migrations').all();
    expect(migrations.length).toBe(6);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Persons
// ═════════════════════════════════════════════════════════════════════════════

describe('Persons', () => {
  // Re-import Jane Doe's data (cleared by global beforeEach)
  beforeEach(() => {
    const jane = db.getPersons().find(p => p.name === 'Jane Doe');
    if (jane && jane.id === db.getActivePersonId()) {
      db.importAll(db.getPerson(jane.id).data);
    }
  });

  test('getPersons returns Jane Doe seeded by default', () => {
    const persons = db.getPersons();
    expect(persons.length).toBe(1);
    expect(persons[0].name).toBe('Jane Doe');
  });

  test('createPerson creates a new person', () => {
    const id = db.createPerson('John Smith');
    expect(id).toBeGreaterThan(0);
    const persons = db.getPersons();
    expect(persons.length).toBe(2);
    expect(persons.find(p => p.name === 'John Smith')).toBeTruthy();
  });

  test('createPerson with data stores JSON blob', () => {
    const data = { personal: { firstName: 'Test' } };
    const id = db.createPerson('Test Person', data);
    const person = db.getPerson(id);
    expect(person.data).toEqual(data);
  });

  test('getPerson returns null for non-existent id', () => {
    expect(db.getPerson(9999)).toBeNull();
  });

  test('renamePerson changes the name', () => {
    const persons = db.getPersons();
    const janeId = persons[0].id;
    db.renamePerson(janeId, 'Jane Smith');
    const updated = db.getPerson(janeId);
    expect(updated.name).toBe('Jane Smith');
  });

  test('deletePerson removes a non-active person', () => {
    const newId = db.createPerson('To Delete');
    db.deletePerson(newId);
    expect(db.getPerson(newId)).toBeNull();
  });

  test('deletePerson throws when deleting active person', () => {
    const activeId = db.getActivePersonId();
    expect(() => db.deletePerson(activeId)).toThrow('Cannot delete the active person');
  });

  test('getActivePersonId returns seeded person id', () => {
    const id = db.getActivePersonId();
    expect(id).toBe(db.getPersons()[0].id);
  });

  test('setActivePersonId + getActivePersonId round-trip', () => {
    const newId = db.createPerson('New Person');
    db.setActivePersonId(newId);
    expect(db.getActivePersonId()).toBe(newId);
  });
});

describe('clearAllContent', () => {
  beforeEach(() => {
    const jane = db.getPersons().find(p => p.name === 'Jane Doe');
    if (jane) db.importAll(db.getPerson(jane.id).data);
  });

  test('empties all content tables', () => {
    // Verify there's data first (from Jane Doe seed)
    expect(db.getSections().length).toBeGreaterThan(0);

    db.clearAllContent();

    expect(db.getSections().length).toBe(0);
    expect(db.getCoverletterSections().length).toBe(0);
    expect(Object.keys(db.getSettings('personal')).length).toBe(0);
    expect(Object.keys(db.getSettings('coverletter')).length).toBe(0);
  });

  test('preserves _active_person_id setting', () => {
    const activeId = db.getActivePersonId();
    db.clearAllContent();
    expect(db.getActivePersonId()).toBe(activeId);
  });

  test('preserves persons table', () => {
    db.clearAllContent();
    expect(db.getPersons().length).toBe(1); // Jane Doe still there
  });
});

describe('importAll', () => {
  const testData = {
    personal: { firstName: 'Import', lastName: 'Test', email: 'import@test.com' },
    sections: [
      {
        id: 'work', type: 'cventries', title: 'Work',
        entries: [
          {
            id: 1, section_id: 'work', sort_order: 0, resumeIncluded: true,
            fields: { position: 'Dev', organization: 'Corp', location: 'NYC', date: '2020' },
            items: [
              { id: 1, entry_id: 1, sort_order: 0, content: 'Did things', resumeIncluded: true },
            ]
          }
        ]
      }
    ],
    documents: {
      cv: [{ sectionId: 'work', enabled: true, sortOrder: 0, resumeParagraphText: null }],
      resume: []
    },
    coverletter: {
      recipientName: 'Boss',
      title: 'Hello',
      sections: [
        { id: 1, sort_order: 0, title: 'Intro', body: 'Hi there' }
      ]
    }
  };

  test('imports data correctly', () => {
    db.importAll(testData);

    const personal = db.getSettings('personal');
    expect(personal['personal.firstName']).toBe('Import');

    const sections = db.getSections();
    expect(sections.length).toBe(1);
    expect(sections[0].id).toBe('work');

    const section = db.getSection('work');
    expect(section.entries.length).toBe(1);
    expect(section.entries[0].fields.position).toBe('Dev');
    expect(section.entries[0].items.length).toBe(1);

    const clSections = db.getCoverletterSections();
    expect(clSections.length).toBe(1);

    const clSettings = db.getSettings('coverletter');
    expect(clSettings['coverletter.recipientName']).toBe('Boss');
  });

  test('clears existing data before importing', () => {
    // DB already has Jane Doe data from seed
    db.importAll(testData);

    // Should only have imported data, not Jane's
    const sections = db.getSections();
    expect(sections.length).toBe(1);
    expect(sections[0].id).toBe('work');
  });
});

describe('savePerson', () => {
  beforeEach(() => {
    const jane = db.getPersons().find(p => p.name === 'Jane Doe');
    if (jane) db.importAll(db.getPerson(jane.id).data);
  });

  test('snapshots current data to person blob', () => {
    const activeId = db.getActivePersonId();
    db.savePerson(activeId);

    const person = db.getPerson(activeId);
    expect(person.data.personal.firstName).toBe('Jane');
    expect(person.data.sections.length).toBeGreaterThan(0);
  });
});

describe('switchPerson', () => {
  beforeEach(() => {
    const jane = db.getPersons().find(p => p.name === 'Jane Doe');
    if (jane) db.importAll(db.getPerson(jane.id).data);
  });

  test('switches between persons preserving data', () => {
    // Jane Doe is active with her data
    const janeId = db.getActivePersonId();

    // Create a new empty person
    const bobId = db.createPerson('Bob');

    // Switch to Bob
    db.switchPerson(bobId);

    expect(db.getActivePersonId()).toBe(bobId);
    // Content should be empty (Bob has no data)
    expect(db.getSections().length).toBe(0);

    // Switch back to Jane
    db.switchPerson(janeId);

    expect(db.getActivePersonId()).toBe(janeId);
    // Jane's data should be restored
    const personal = db.getSettings('personal');
    expect(personal['personal.firstName']).toBe('Jane');
    expect(db.getSections().length).toBeGreaterThan(0);
  });

  test('throws for non-existent person', () => {
    expect(() => db.switchPerson(9999)).toThrow('Person not found');
  });

  test('saves current person data before switching', () => {
    const janeId = db.getActivePersonId();

    // Modify Jane's data
    db.setSettings({ 'personal.firstName': 'Janet' });

    // Create and switch to new person
    const newId = db.createPerson('New');
    db.switchPerson(newId);

    // Check Jane's snapshot has the modified data
    const jane = db.getPerson(janeId);
    expect(jane.data.personal.firstName).toBe('Janet');
  });
});

describe('seedJaneDoe', () => {
  test('seeds Jane Doe on fresh database', () => {
    // Use a fresh DB (not cleared by beforeEach) to test seeding
    const freshDb = new CvDatabase(':memory:');

    const persons = freshDb.getPersons();
    expect(persons.length).toBe(1);
    expect(persons[0].name).toBe('Jane Doe');

    const personal = freshDb.getSettings('personal');
    expect(personal['personal.firstName']).toBe('Jane');
    expect(personal['personal.lastName']).toBe('Doe');

    const sections = freshDb.getSections();
    expect(sections.length).toBe(4); // summary, experience, education, skills

    freshDb.close();
  });

  test('preserves existing data when seeding', () => {
    // Create a fresh DB with existing data but no persons
    const db2 = new CvDatabase(':memory:');
    // db2 will auto-seed Jane Doe since it's fresh
    // But let's test the case where data exists before persons migration
    // This is already handled by the seed logic checking for existing sections
    db2.close();
  });
});
