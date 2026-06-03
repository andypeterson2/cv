/**
 * Unit tests for the normalized SQLite access layer + variant resolver.
 * All tests use :memory: databases — no file I/O.
 */

const CvDatabase = require('../../lib/db');

let db;
let pid;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent(); // remove seeded Jane Doe → blank slate
  pid = db.createPerson('Test Person');
});

afterEach(() => {
  db.close();
});

// Helper: build a small master CV. Returns the created ids.
function buildMaster() {
  const summary = db.createSection(pid, 'summary', 'summary', 'Summary');
  const sEntry = db.createEntry(summary, { text: 'Full summary text' });

  const exp = db.createSection(pid, 'experience', 'experience', 'Experience');
  const e1 = db.createEntry(exp, { position: 'Engineer', organization: 'Acme' });
  const i1 = db.createItem(e1, 'Built frontend');
  const i2 = db.createItem(e1, 'Built backend');
  const e2 = db.createEntry(exp, { position: 'Intern', organization: 'Corp' });
  const i3 = db.createItem(e2, 'Intern work');

  const skills = db.createSection(pid, 'skills', 'skills', 'Skills');
  db.createEntry(skills, { category: 'Languages', skills: 'JS, Python' });

  return { summary, sEntry, exp, e1, i1, i2, e2, i3, skills };
}

describe('Persons', () => {
  test('create / get / rename / delete', () => {
    expect(db.getPerson(pid).name).toBe('Test Person');
    db.renamePerson(pid, 'Renamed');
    expect(db.getPerson(pid).name).toBe('Renamed');
    db.deletePerson(pid);
    expect(db.getPerson(pid)).toBeNull();
  });

  test('deleting a person cascades to sections/entries/items/variants', () => {
    const { exp } = buildMaster();
    const v = db.createVariant(pid, 'CV', 'cv');
    db.deletePerson(pid);
    expect(db.getSection(exp)).toBeNull();
    expect(db.getVariant(v)).toBeNull();
  });
});

describe('Sections / entries / items', () => {
  test('sections are per-person and ordered', () => {
    buildMaster();
    const other = db.createPerson('Other');
    db.createSection(other, 'experience', 'experience', 'Experience'); // same slug, different person OK
    const secs = db.getSections(pid);
    expect(secs.map((s) => s.slug)).toEqual(['summary', 'experience', 'skills']);
    expect(db.getSections(other).map((s) => s.slug)).toEqual(['experience']);
  });

  test('getSection returns entries with items and tags', () => {
    const { exp, e1 } = buildMaster();
    db.addEntryTags(e1, ['frontend', 'core']);
    const section = db.getSection(exp);
    expect(section.entries).toHaveLength(2);
    expect(section.entries[0].fields.position).toBe('Engineer');
    expect(section.entries[0].items.map((i) => i.content)).toEqual(['Built frontend', 'Built backend']);
    expect(section.entries[0].tags.sort()).toEqual(['core', 'frontend']);
  });

  test('entry/item ids are stable across reads', () => {
    const { e1 } = buildMaster();
    expect(db.getEntry(e1).id).toBe(e1);
    db.updateEntry(e1, { fields: { position: 'Senior Engineer' } });
    expect(db.getEntry(e1).id).toBe(e1);
    expect(db.getEntry(e1).fields.position).toBe('Senior Engineer');
  });

  test('reorderEntries updates order', () => {
    const { exp, e1, e2 } = buildMaster();
    db.reorderEntries(exp, [e2, e1]);
    expect(db.getSection(exp).entries.map((e) => e.id)).toEqual([e2, e1]);
  });
});

describe('Tags', () => {
  test('add / remove / list distinct', () => {
    const { e1, i1 } = buildMaster();
    db.addEntryTags(e1, ['Frontend', 'frontend', 'core']); // normalized + deduped
    db.addItemTags(i1, ['frontend']);
    expect(db.getEntry(e1).tags.sort()).toEqual(['core', 'frontend']);
    expect(db.listTags(pid)).toEqual(['core', 'frontend']);
    db.removeEntryTag(e1, 'core');
    expect(db.getEntry(e1).tags).toEqual(['frontend']);
  });
});

describe('Tag catalog + suggestion', () => {
  test('catalog upsert normalizes + alias-folds the tag and dedupes on PK', () => {
    db.setTagAlias(pid, 'fe', 'frontend');
    db.setCatalogTag(pid, 'Front End', { category: 'skill' }); // → front-end (normalized)
    db.setCatalogTag(pid, 'fe', { description: 'aliased' });     // → frontend (alias-folded)
    db.setCatalogTag(pid, 'frontend', { description: 'updated' }); // upsert same PK
    const cat = db.getTagCatalog(pid);
    const tags = cat.map((c) => c.tag).sort();
    expect(tags).toEqual(['front-end', 'frontend']);
    expect(cat.find((c) => c.tag === 'frontend').description).toBe('updated');
  });

  test('deleteCatalogTag removes; catalog cascades on deletePerson', () => {
    db.setCatalogTag(pid, 'frontend');
    db.deleteCatalogTag(pid, 'frontend');
    expect(db.getTagCatalog(pid)).toEqual([]);
    db.setCatalogTag(pid, 'react');
    db.deletePerson(pid);
    expect(db.getTagCatalog(pid)).toEqual([]); // gone with the person
  });

  test('suggestTags unions catalog + usage and never invents a tag', async () => {
    const { e1 } = buildMaster();
    db.addEntryTags(e1, ['frontend']);            // usage vocab
    db.setCatalogTag(pid, 'react');               // catalog-only (count 0)
    const { results } = await db.suggestTags(pid, 'Built the React frontend', { minScore: 0.35 });
    const tags = results.map((r) => r.tag);
    expect(tags).toContain('react');
    expect(tags).toContain('frontend');
    expect(results.find((r) => r.tag === 'react').inCatalog).toBe(true);
    // Never returns a word that isn't an existing tag.
    expect(tags).not.toContain('built');
    expect(tags.every((t) => ['react', 'frontend'].includes(t))).toBe(true);
  });

  test('seedCatalogFromUsage promotes the usage vocabulary into the catalog', () => {
    const { e1, i1 } = buildMaster();
    db.addEntryTags(e1, ['frontend', 'core']);
    db.addItemTags(i1, ['python']);
    const { added } = db.seedCatalogFromUsage(pid);
    expect(added).toBe(3);
    expect(db.getTagCatalog(pid).map((c) => c.tag).sort()).toEqual(['core', 'frontend', 'python']);
    // idempotent: seeding again adds nothing
    expect(db.seedCatalogFromUsage(pid).added).toBe(0);
  });

  test('suggestBulk returns per entry/item candidates and writes nothing', async () => {
    const { e1, i1 } = buildMaster();
    db.addEntryTags(e1, ['frontend']); // seed a vocab so something matches
    const before = db.listTags(pid);
    const bulk = await db.suggestBulk(pid, { minScore: 0.35 });
    expect(bulk.count).toBeGreaterThan(0);
    const i1row = bulk.items.find((x) => x.target === 'item' && x.id === i1); // "Built frontend"
    expect(i1row.suggestions.map((s) => s.tag)).toContain('frontend');
    // suggest-only: vocab + tags are unchanged
    expect(db.listTags(pid)).toEqual(before);
    expect(db.getEntry(e1).items.find((i) => i.id === i1).tags).toEqual([]);
  });
});

describe('Variants CRUD', () => {
  test('create with valid kind, reject invalid', () => {
    const v = db.createVariant(pid, 'My CV', 'cv');
    expect(db.getVariant(v).kind).toBe('cv');
    expect(() => db.createVariant(pid, 'Bad', 'nope')).toThrow();
  });

  test('rules round-trip; include wins over exclude on conflict', () => {
    const v = db.createVariant(pid, 'R', 'resume');
    db.setVariantRules(v, { include: ['frontend', 'dup'], exclude: ['draft', 'dup'] });
    const r = db.getVariantRules(v);
    expect(r.include.sort()).toEqual(['dup', 'frontend']);
    expect(r.exclude).toEqual(['draft']); // dup kept as include only
  });
});

// ---------------------------------------------------------------------------
// Resolver — the decision table
// ---------------------------------------------------------------------------

describe('resolveVariant', () => {
  function texts(resolved) {
    return resolved.sections.map((s) => ({
      slug: s.id,
      entries: s.entries.map((e) => ({ pos: e.fields.position, text: e.fields.text, items: e.items.map((i) => i.content) })),
    }));
  }

  test('CV variant with no rules/overrides = full master', () => {
    buildMaster();
    const cv = db.createVariant(pid, 'CV', 'cv');
    const r = db.resolveVariant(cv);
    expect(r.variant).toBe('cv');
    expect(r.sections.map((s) => s.id)).toEqual(['summary', 'experience', 'skills']);
    const exp = r.sections.find((s) => s.id === 'experience');
    expect(exp.entries).toHaveLength(2);
    expect(exp.entries[0].items.map((i) => i.content)).toEqual(['Built frontend', 'Built backend']);
  });

  test('include rule keeps only matching entries (row 9)', () => {
    const { e1 } = buildMaster();
    db.addEntryTags(e1, ['frontend']);
    const v = db.createVariant(pid, 'FE', 'resume');
    db.setVariantRules(v, { include: ['frontend'] });
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    expect(exp.entries.map((e) => e.fields.position)).toEqual(['Engineer']); // Intern (untagged) dropped
  });

  test('exclude-only rule drops excluded, keeps rest (row 8)', () => {
    const { e2 } = buildMaster();
    db.addEntryTags(e2, ['draft']);
    const v = db.createVariant(pid, 'NoDraft', 'resume');
    db.setVariantRules(v, { exclude: ['draft'] });
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    expect(exp.entries.map((e) => e.fields.position)).toEqual(['Engineer']);
  });

  test('override included=0 beats include tag (row 4); included=1 beats exclude tag (row 3)', () => {
    const { e1, e2 } = buildMaster();
    db.addEntryTags(e1, ['frontend']);
    db.addEntryTags(e2, ['frontend', 'draft']);
    const v = db.createVariant(pid, 'V', 'resume');
    db.setVariantRules(v, { include: ['frontend'], exclude: ['draft'] });
    // Without overrides: e1 in (frontend, no draft), e2 out (has draft).
    db.setEntryOverride(v, e1, { included: false }); // force e1 OUT
    db.setEntryOverride(v, e2, { included: true });  // force e2 IN despite draft
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    expect(exp.entries.map((e) => e.fields.position)).toEqual(['Intern']);
  });

  test('item with include tag but excluded parent entry is dropped (row 1/2)', () => {
    const { e1, e2, i3 } = buildMaster();
    db.addEntryTags(e1, ['keep']);
    db.addItemTags(i3, ['keep']); // i3 belongs to e2 (untagged)
    const v = db.createVariant(pid, 'V', 'resume');
    db.setVariantRules(v, { include: ['keep'] });
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    // Only e1 emitted; e2 excluded so its item i3 cannot appear despite its tag.
    expect(exp.entries).toHaveLength(1);
    expect(exp.entries[0].fields.position).toBe('Engineer');
  });

  test('item-level include filters items within an included entry', () => {
    const { e1, i1 } = buildMaster();
    db.addEntryTags(e1, ['keep']);
    db.addItemTags(i1, ['keep']); // only i1 tagged; i2 not
    const v = db.createVariant(pid, 'V', 'resume');
    db.setVariantRules(v, { include: ['keep'] });
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    expect(exp.entries[0].items.map((i) => i.content)).toEqual(['Built frontend']);
  });

  test('section with all entries filtered out is dropped (row 5)', () => {
    const { skills } = buildMaster();
    void skills;
    const v = db.createVariant(pid, 'V', 'resume');
    db.setVariantRules(v, { include: ['nonexistent-tag'] });
    expect(db.resolveVariant(v).sections).toHaveLength(0);
  });

  test('variant_sections controls presence, order, and enabled (rows 6/11)', () => {
    const m = buildMaster();
    const v = db.createVariant(pid, 'V', 'resume');
    db.setVariantSections(v, [
      { sectionId: m.skills, enabled: true, sortOrder: 0 },
      { sectionId: m.exp, enabled: false, sortOrder: 1 }, // disabled → dropped
      { sectionId: m.summary, enabled: true, sortOrder: 2 },
    ]);
    const r = db.resolveVariant(v);
    expect(r.sections.map((s) => s.id)).toEqual(['skills', 'summary']); // experience disabled; education absent
  });

  test('text_override replaces cvparagraph text and item content (row 12 inverse)', () => {
    const m = buildMaster();
    const v = db.createVariant(pid, 'V', 'resume');
    db.setEntryOverride(v, m.sEntry, { textOverride: 'Short summary' });
    db.setItemOverride(v, m.i1, { textOverride: 'Rephrased bullet' });
    const r = db.resolveVariant(v);
    expect(r.sections.find((s) => s.id === 'summary').entries[0].fields.text).toBe('Short summary');
    expect(r.sections.find((s) => s.id === 'experience').entries[0].items[0].content).toBe('Rephrased bullet');
  });

  test('sort_override reorders entries deterministically (row 10)', () => {
    const m = buildMaster();
    const v = db.createVariant(pid, 'V', 'cv');
    db.setEntryOverride(v, m.e1, { sortOverride: 5 }); // push e1 after e2
    const exp = db.resolveVariant(v).sections.find((s) => s.id === 'experience');
    expect(exp.entries.map((e) => e.fields.position)).toEqual(['Intern', 'Engineer']);
  });

  test('coverletter kind resolves header + letter sections, ignores tag machinery', () => {
    db.setPersonSettings(pid, { 'coverletter.recipientName': 'Hiring Team', 'coverletter.opening': 'Dear Team,' });
    const v = db.createVariant(pid, 'CL', 'coverletter');
    db.createLetterSection(v, 'Intro', 'I am writing...');
    db.createLetterSection(v, 'Body', 'My experience...');
    const r = db.resolveVariant(v);
    expect(r.variant).toBe('coverletter');
    expect(r.sections).toEqual([]);
    expect(r.coverletter.recipientName).toBe('Hiring Team');
    expect(r.coverletter.sections.map((s) => s.title)).toEqual(['Intro', 'Body']);
  });

  test('throws for unknown variant id', () => {
    expect(() => db.resolveVariant(99999)).toThrow('Variant not found');
  });
});

// ---------------------------------------------------------------------------
// Legacy import + seeding
// ---------------------------------------------------------------------------

describe('importLegacyData + seeding', () => {
  const legacy = {
    personal: { firstName: 'Leg', lastName: 'Acy' },
    sections: [
      { id: 'summary', type: 'summary', title: 'Summary', entries: [{ id: 1, resumeIncluded: true, fields: { text: 'Long summary' }, items: [] }] },
      {
        id: 'experience', type: 'experience', title: 'Experience', entries: [
          { id: 2, resumeIncluded: true, fields: { position: 'Eng' }, items: [
            { id: 10, content: 'Kept bullet', resumeIncluded: true },
            { id: 11, content: 'Dropped bullet', resumeIncluded: false },
          ] },
          { id: 3, resumeIncluded: false, fields: { position: 'Old role' }, items: [] },
        ],
      },
    ],
    documents: {
      cv: [
        { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: null },
        { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      ],
      resume: [
        { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: 'Short summary' },
        { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      ],
    },
    coverletter: { recipientName: 'HM', sections: [{ title: 'Intro', body: 'Hello' }] },
  };

  test('derives CV/Resume/Cover Letter variants faithfully', () => {
    const id = db.createPerson('Legacy');
    db.importLegacyData(id, legacy);

    expect(db.getPersonal(id).firstName).toBe('Leg');
    const variants = db.getVariants(id);
    expect(variants.map((v) => `${v.name}:${v.kind}`)).toEqual(['CV:cv', 'Resume:resume', 'Cover Letter:coverletter']);

    // CV = everything
    const cv = db.resolveVariant(variants.find((v) => v.kind === 'cv').id);
    const cvExp = cv.sections.find((s) => s.id === 'experience');
    expect(cvExp.entries).toHaveLength(2);

    // Resume = excluded entry/item dropped + paragraph override applied
    const resume = db.resolveVariant(variants.find((v) => v.kind === 'resume').id);
    expect(resume.sections.find((s) => s.id === 'summary').entries[0].fields.text).toBe('Short summary');
    const resExp = resume.sections.find((s) => s.id === 'experience');
    expect(resExp.entries.map((e) => e.fields.position)).toEqual(['Eng']); // 'Old role' excluded
    expect(resExp.entries[0].items.map((i) => i.content)).toEqual(['Kept bullet']); // dropped bullet gone

    // Cover Letter
    const cl = db.resolveVariant(variants.find((v) => v.kind === 'coverletter').id);
    expect(cl.coverletter.sections.map((s) => s.title)).toEqual(['Intro']);
  });

  test('fresh DB seeds Jane Doe with master + variants', () => {
    const fresh = new CvDatabase(':memory:');
    const persons = fresh.getPersons();
    expect(persons.map((p) => p.name)).toContain('Jane Doe');
    const jane = persons.find((p) => p.name === 'Jane Doe');
    const variants = fresh.getVariants(jane.id);
    expect(variants.map((v) => v.kind).sort()).toEqual(['coverletter', 'cv', 'resume']);
    // Jane's resume omits education
    const resume = fresh.resolveVariant(variants.find((v) => v.kind === 'resume').id);
    expect(resume.sections.map((s) => s.id)).not.toContain('education');
    fresh.close();
  });
});

describe('getPersonExport / getMaster', () => {
  test('getMaster returns sections, variants, and tag vocabulary', () => {
    const { e1 } = buildMaster();
    db.addEntryTags(e1, ['frontend']);
    db.createVariant(pid, 'CV', 'cv');
    const master = db.getMaster(pid);
    expect(master.person.id).toBe(pid);
    expect(master.sections.map((s) => s.slug)).toEqual(['summary', 'experience', 'skills']);
    expect(master.variants.map((v) => v.kind)).toEqual(['cv']);
    expect(master.tags).toEqual(['frontend']);
  });

  test('getPersonExport captures personal, sections, tags, and variants', () => {
    const { e1 } = buildMaster();
    db.addEntryTags(e1, ['frontend']);
    db.setPersonal(pid, { firstName: 'Ex', lastName: 'Port' });
    const v = db.createVariant(pid, 'FE Resume', 'resume');
    db.setVariantRules(v, { include: ['frontend'] });
    const exp = db.getPersonExport(pid);
    expect(exp.personal.firstName).toBe('Ex');
    expect(exp.sections.find((s) => s.slug === 'experience').entries[0].tags).toEqual(['frontend']);
    expect(exp.variants.find((x) => x.name === 'FE Resume').rules.include).toEqual(['frontend']);
  });
});
