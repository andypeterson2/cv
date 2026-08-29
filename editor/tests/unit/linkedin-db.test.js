/**
 * LinkedIn sync end-to-end over the DB — migration 015 + the mixin + resolveVariant
 * + the exporter together. The drift detection is the feature, so it's what's pinned:
 * mark-synced flips state, and a later edit drifts exactly the entry that changed.
 */
const CvDatabase = require('../../lib/db');
const { exportLinkedin } = require('../../lib/linkedin');

let db;
let pid;
let entryA;
let entryB;
let variantId;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent(); // drop seeded Jane Doe → blank slate
  pid = db.createPerson('Test Person');
  const sec = db.createSection(pid, 'experience', 'experience', 'Experience');
  entryA = db.createEntry(sec, {
    position: 'Engineer',
    organization: 'Acme',
    location: 'NYC',
    date: 'January 2020 -- March 2022',
  });
  db.createItem(entryA, 'Shipped the thing', '');
  entryB = db.createEntry(sec, {
    position: 'Intern',
    organization: 'Globex',
    location: 'Remote',
    date: 'June 2019 -- August 2019',
  });
  db.createItem(entryB, 'Learned the ropes', '');
  variantId = db.createVariant(pid, 'CV', 'cv');
});

afterEach(() => db.close());

const positions = () => exportLinkedin(db.resolveVariant(variantId)).positions;
const marks = (ps) => ps.map((p) => ({ entryId: p.entryId, fingerprint: p.fingerprint }));
const stateById = (status) => Object.fromEntries(status.map((s) => [s.entryId, s.state]));

test('migration 015 applied: linkedin_sync is queryable, everything starts new', () => {
  const status = db.linkedinStatus(pid, positions());
  expect(status.map((s) => s.state)).toEqual(['new', 'new']);
  expect(status[0]).toMatchObject({ entryId: entryA, title: 'Engineer', company: 'Acme' });
});

test('mark-synced flips to synced and stamps syncedAt', () => {
  const marked = db.markLinkedinSynced(pid, marks(positions()), '2026-07-15T00:00:00.000Z');
  expect(marked).toBe(2);
  const status = db.linkedinStatus(pid, positions());
  expect(status.map((s) => s.state)).toEqual(['synced', 'synced']);
  expect(status[0].syncedAt).toBe('2026-07-15T00:00:00.000Z');
});

test('editing one entry drifts only that entry', () => {
  db.markLinkedinSynced(pid, marks(positions()), '2026-07-15T00:00:00.000Z');
  const item = db
    .getMain(pid)
    .sections.find((s) => s.type === 'experience')
    .entries.find((e) => e.id === entryA).items[0];
  db.updateItem(item.id, { content: 'Shipped the thing, faster' });
  const by = stateById(db.linkedinStatus(pid, positions()));
  expect(by[entryA]).toBe('drifted');
  expect(by[entryB]).toBe('synced');
});

test('marking a subset stamps only those; the rest stay new', () => {
  db.markLinkedinSynced(
    pid,
    marks(positions().filter((p) => p.entryId === entryA)),
    '2026-07-15T00:00:00.000Z',
  );
  const by = stateById(db.linkedinStatus(pid, positions()));
  expect(by[entryA]).toBe('synced');
  expect(by[entryB]).toBe('new');
});

test('linkedinPersonForVariant resolves the owner', () => {
  expect(db.linkedinPersonForVariant(variantId)).toBe(pid);
  expect(db.linkedinPersonForVariant(999999)).toBe(null);
});
