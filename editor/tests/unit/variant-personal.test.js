/**
 * Per-variant personal.* overrides: the resolve-time merge, the inherit/suppress
 * distinction, and survival through export/import. The tagline a variant renders
 * comes out of this merge, so each rule in it is pinned here.
 */
const CvDatabase = require('../../lib/db');

let db;
let pid;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  pid = db.createProfile('Test Profile');
  db.setPersonal(pid, { firstName: 'Test', lastName: 'Profile', position: 'Profile Tagline' });
});

afterEach(() => {
  db.close();
});

describe('variant personal overrides — storage', () => {
  test('a variant with no overrides reads as an empty map', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    expect(db.getVariantPersonal(v)).toEqual({});
  });

  test('set, then read back only the overridden keys', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline' });
    expect(db.getVariantPersonal(v)).toEqual({ position: 'Variant Tagline' });
  });

  test('null drops the override; empty string is kept as a value', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline', quote: 'Some quote' });
    db.setVariantPersonal(v, { position: null, quote: '' });
    expect(db.getVariantPersonal(v)).toEqual({ quote: '' });
  });

  test('overrides are per variant, not shared', () => {
    const a = db.createVariant(pid, 'A', 'cv');
    const b = db.createVariant(pid, 'B', 'resume');
    db.setVariantPersonal(a, { position: 'A Tagline' });
    expect(db.getVariantPersonal(b)).toEqual({});
  });

  test('deleting the variant drops its overrides', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline' });
    db.deleteVariant(v);
    expect(db.getVariantPersonal(v)).toEqual({});
  });
});

describe('variant personal overrides — resolveVariant merge', () => {
  test('no override inherits the profile value', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    expect(db.resolveVariant(v).personal.position).toBe('Profile Tagline');
  });

  test('an override wins over the profile value', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline' });
    expect(db.resolveVariant(v).personal.position).toBe('Variant Tagline');
  });

  test('an empty override suppresses the field', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: '' });
    expect(db.resolveVariant(v).personal.position).toBe('');
  });

  test('unrelated personal fields still come from the profile', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline' });
    expect(db.resolveVariant(v).personal.firstName).toBe('Test');
  });

  test('a cover-letter variant gets the merge too', () => {
    const v = db.createVariant(pid, 'CL', 'coverletter');
    db.setVariantPersonal(v, { position: 'Letter Tagline' });
    expect(db.resolveVariant(v).personal.position).toBe('Letter Tagline');
  });

  test('resolveMain keeps the profile value — it has no variant lens', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantPersonal(v, { position: 'Variant Tagline' });
    expect(db.resolveMain(pid).personal.position).toBe('Profile Tagline');
  });
});

describe('variant personal overrides — export / import', () => {
  test('export carries the overrides; a variant without any exports {}', () => {
    const a = db.createVariant(pid, 'A', 'cv');
    db.createVariant(pid, 'B', 'resume');
    db.setVariantPersonal(a, { position: 'A Tagline' });
    const exported = db.getProfileExport(pid);
    const byName = Object.fromEntries(exported.variants.map((v) => [v.name, v.personal]));
    expect(byName.A).toEqual({ position: 'A Tagline' });
    expect(byName.B).toEqual({});
  });

  test('import restores the overrides on the new profile', () => {
    const a = db.createVariant(pid, 'A', 'cv');
    db.setVariantPersonal(a, { position: 'A Tagline', quote: '' });
    const exported = db.getProfileExport(pid);

    const pid2 = db.createProfile('Imported');
    db.importProfileData(pid2, exported);
    const v2 = db.getVariants(pid2).find((v) => v.name === 'A');
    expect(db.getVariantPersonal(v2.id)).toEqual({ position: 'A Tagline', quote: '' });
    expect(db.resolveVariant(v2.id).personal.position).toBe('A Tagline');
  });
});
