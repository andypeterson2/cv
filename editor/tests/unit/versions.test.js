/**
 * Version history (ADR-006 increment 1): snapshot → list → restore round-trips the
 * whole person, and restore REPLACES (never appends) content while keeping the
 * person row and its history. :memory: DB, migrations auto-run — no file I/O.
 */
const CvDatabase = require('../../lib/db');

let db;
let pid;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent(); // remove the seeded person → blank slate
  pid = db.createPerson('Test Person');
});

afterEach(() => {
  db.close();
});

function buildMain() {
  const exp = db.createSection(pid, 'experience', 'experience', 'Experience');
  const e1 = db.createEntry(exp, { position: 'Engineer', organization: 'Acme' });
  db.createItem(e1, 'Built the frontend');
  db.createItem(e1, 'Built the backend');
  db.createVariant(pid, 'CV', 'cv');
  return { exp, e1 };
}

describe('Versions (ADR-006)', () => {
  test('snapshots the export; lists newest-first with numeric timestamps', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'first'));
    const v2 = Number(db.createVersion(pid, 'second'));
    const list = db.listVersions(pid);
    expect(list.map((v) => v.id)).toEqual([v2, v1]);
    expect(list.map((v) => v.label)).toEqual(['second', 'first']);
    expect(typeof list[0].createdAt).toBe('number');
  });

  test('an untitled snapshot stores an empty label', () => {
    buildMain();
    db.createVersion(pid);
    expect(db.listVersions(pid)[0].label).toBe('');
  });

  test('restore replaces content and round-trips the document exactly', () => {
    buildMain();
    const before = db.getPersonExport(pid);
    const v1 = Number(db.createVersion(pid, 'checkpoint'));

    // diverge: add a whole section after the checkpoint
    const extra = db.createSection(pid, 'skills', 'skills', 'Skills');
    db.createEntry(extra, { category: 'Languages', skills: 'JS, Python' });
    expect(db.getSections(pid)).toHaveLength(2);

    expect(db.restoreVersion(pid, v1)).toBe(true);
    expect(db.getPersonExport(pid)).toEqual(before); // exact round-trip
    expect(db.getSections(pid)).toHaveLength(1); // the extra section is gone, not appended
  });

  test('restoring twice does not duplicate content (it clears first)', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'cp'));
    db.restoreVersion(pid, v1);
    db.restoreVersion(pid, v1);
    const exp = db.getPersonExport(pid);
    expect(exp.sections).toHaveLength(1);
    expect(exp.sections[0].entries[0].items).toHaveLength(2);
    expect(exp.variants).toHaveLength(1);
  });

  test('a checkpoint survives restoring — history is not wiped', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'cp'));
    db.restoreVersion(pid, v1);
    expect(db.listVersions(pid).map((v) => v.id)).toContain(v1);
  });

  test('restoreVersion returns false for an unknown id', () => {
    buildMain();
    expect(db.restoreVersion(pid, 99999)).toBe(false);
  });

  test('versions are scoped per person', () => {
    buildMain();
    const other = db.createPerson('Other');
    db.createVersion(pid, 'mine');
    expect(db.listVersions(other)).toHaveLength(0);
    expect(db.getVersionDoc(other, db.listVersions(pid)[0].id)).toBeNull();
  });

  test('getVersion returns metadata + parsed doc; null for unknown or wrong person', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'cp'));
    const full = db.getVersion(pid, v1);
    expect(full.id).toBe(v1);
    expect(full.label).toBe('cp');
    expect(typeof full.createdAt).toBe('number');
    expect(Array.isArray(full.doc.sections)).toBe(true);
    expect(db.getVersion(pid, 99999)).toBeNull();
    const other = db.createPerson('Other');
    expect(db.getVersion(other, v1)).toBeNull(); // scoped per person
  });

  test('branches: createVersion records branch + parent; listVersions returns them', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'main-1', 'main', null));
    const v2 = Number(db.createVersion(pid, 'industry-1', 'industry', v1));
    const byId = Object.fromEntries(db.listVersions(pid).map((v) => [v.id, v]));
    expect(byId[v1].branch).toBe('main');
    expect(byId[v2].branch).toBe('industry');
    expect(byId[v2].parent).toBe(v1);
  });

  test('a version defaults to the main branch', () => {
    buildMain();
    const v = Number(db.createVersion(pid, 'cp'));
    expect(db.listVersions(pid).find((x) => x.id === v).branch).toBe('main');
  });

  test('tags: setTag sets/clears a provenance name; surfaces in list + getVersion', () => {
    buildMain();
    const v1 = Number(db.createVersion(pid, 'cp'));
    expect(db.setTag(pid, v1, 'sent-to-google')).toBe(true);
    expect(db.listVersions(pid)[0].tag).toBe('sent-to-google');
    expect(db.getVersion(pid, v1).tag).toBe('sent-to-google');
    db.setTag(pid, v1, ''); // clear
    expect(db.getVersion(pid, v1).tag).toBeUndefined();
    expect(db.setTag(pid, 99999, 'x')).toBe(false); // unknown id
  });

  test('deleting a person cascades its versions away', () => {
    buildMain();
    db.createVersion(pid, 'cp');
    db.deletePerson(pid);
    expect(db.listVersions(pid)).toHaveLength(0);
  });
});
