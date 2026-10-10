/**
 * Per-variant style/spacing/fonts overrides: storage, the variant → account →
 * default precedence at resolve time, and survival through export, import and
 * version restore.
 */
const CvDatabase = require('../../lib/db');

let db;
let pid;
let uid;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  pid = db.createProfile('Test Profile');
  uid = db.profileUserId(pid);
  db.setPersonal(pid, { firstName: 'Test', lastName: 'Profile' });
});

afterEach(() => {
  db.close();
});

describe('variant settings — storage', () => {
  test('a variant with no overrides reads as an empty map', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    expect(db.getVariantSettings(v)).toEqual({});
  });

  test('keeps units and strings, and null drops a key', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantSettings(v, {
      'spacing.marginTop': { num: 1.2, unit: 'cm' },
      'style.fontFamily': 'roboto',
    });
    expect(db.getVariantSettings(v)).toEqual({
      'spacing.marginTop': { num: 1.2, unit: 'cm' },
      'style.fontFamily': 'roboto',
    });
    db.setVariantSettings(v, { 'spacing.marginTop': null, 'style.fontFamily': 'source-sans-3' });
    expect(db.getVariantSettings(v)).toEqual({ 'style.fontFamily': 'source-sans-3' });
  });

  test('a unit value replaced by a string loses its unit', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantSettings(v, { 'spacing.marginTop': { num: 1, unit: 'cm' } });
    db.setVariantSettings(v, { 'spacing.marginTop': '2mm' });
    expect(db.getVariantSettings(v)).toEqual({ 'spacing.marginTop': '2mm' });
  });

  test('rows go when the variant is deleted', () => {
    const v = db.createVariant(pid, 'CV', 'cv');
    db.setVariantSettings(v, { 'fonts.contentTextSize': { num: 10, unit: 'pt' } });
    db.deleteVariant(v);
    expect(db.getVariantSettings(v)).toEqual({});
  });
});

describe('variant settings — resolve precedence', () => {
  test('variant beats account, account beats default (left to the render context)', () => {
    db.setSettings(
      {
        'spacing.marginTop': { num: 1, unit: 'cm' },
        'spacing.marginBottom': { num: 2, unit: 'cm' },
        'style.fontFamily': 'roboto',
      },
      uid,
    );
    const v = db.createVariant(pid, 'Tight', 'resume');
    const other = db.createVariant(pid, 'Plain', 'resume');
    db.setVariantSettings(v, {
      'spacing.marginTop': { num: 5, unit: 'mm' },
      'fonts.contentTextSize': { num: 10, unit: 'pt' },
    });

    const r = db.resolveVariant(v);
    expect(r.spacing).toEqual({ marginTop: '5mm', marginBottom: '2cm' });
    expect(r.fonts).toEqual({ contentTextSize: '10pt' });
    expect(r.style).toEqual({ fontFamily: 'roboto' });

    expect(db.resolveVariant(other).spacing).toEqual({ marginTop: '1cm', marginBottom: '2cm' });
    expect(db.resolveMain(pid).spacing).toEqual({ marginTop: '1cm', marginBottom: '2cm' });
  });

  test('account null resets a key to the default', () => {
    db.setSettings({ 'style.fontFamily': 'roboto' }, uid);
    db.setSettings({ 'style.fontFamily': null }, uid);
    expect(db.getSettings('style', uid)).toEqual({});
  });
});

describe('variant settings — export, import, versions', () => {
  test('round-trips through export and import', () => {
    const v = db.createVariant(pid, 'Tight', 'resume');
    db.setVariantSettings(v, { 'spacing.marginTop': { num: 5, unit: 'mm' } });
    const data = db.getProfileExport(pid);
    expect(data.variants.find((x) => x.name === 'Tight').settings).toEqual({
      'spacing.marginTop': { num: 5, unit: 'mm' },
    });

    const copy = db.createProfile('Copy');
    db.importProfileData(copy, data);
    const nv = db.getVariants(copy).find((x) => x.name === 'Tight');
    expect(db.getVariantSettings(nv.id)).toEqual({ 'spacing.marginTop': { num: 5, unit: 'mm' } });
  });

  test('a version restore brings the overrides back', () => {
    const v = db.createVariant(pid, 'Tight', 'resume');
    db.setVariantSettings(v, { 'spacing.marginTop': { num: 5, unit: 'mm' } });
    const ver = db.createVersion(pid, 'before');
    db.setVariantSettings(v, { 'spacing.marginTop': null });
    db.restoreVersion(pid, ver.id ?? ver);
    const nv = db.getVariants(pid).find((x) => x.name === 'Tight');
    expect(db.getVariantSettings(nv.id)).toEqual({ 'spacing.marginTop': { num: 5, unit: 'mm' } });
  });
});
