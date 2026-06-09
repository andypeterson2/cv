/**
 * Layout persistence + selection (P1).
 */
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');
const { selectLayout } = require('../../lib/render/select');
const { BUILTIN_LAYOUTS_DIR } = require('../../lib/render/layouts');
const path = require('path');

let db;
let pid;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  pid = db.createPerson('Test Person');
});

afterEach(() => db.close());

describe('seedBuiltinLayouts', () => {
  it('registers awesome-cv as a builtin layout and sets the default', () => {
    const layouts = db.listLayouts();
    const awesome = layouts.find((l) => l.id === 'awesome-cv');
    expect(awesome).toBeTruthy();
    expect(awesome.source).toBe('builtin');
    expect(awesome.builtin).toBe(true);
    expect(awesome.kinds).toEqual(expect.arrayContaining(['cv', 'resume', 'coverletter']));
    expect(db.getDefaultLayoutId()).toBe('awesome-cv');
  });

  it('is idempotent and records a checksum', () => {
    const before = db.getLayout('awesome-cv').checksum;
    seedBuiltinLayouts(db);
    seedBuiltinLayouts(db);
    expect(db.listLayouts().filter((l) => l.id === 'awesome-cv')).toHaveLength(1);
    expect(db.getLayout('awesome-cv').checksum).toBe(before);
    expect(typeof before).toBe('string');
  });
});

describe('per-variant layout selection', () => {
  it('defaults a new variant to layout_id null', () => {
    const vid = db.createVariant(pid, 'CV', 'cv');
    expect(db.getVariant(vid).layoutId).toBe(null);
  });

  it('sets and reads a variant layout', () => {
    const vid = db.createVariant(pid, 'CV', 'cv');
    db.setVariantLayout(vid, 'awesome-cv');
    expect(db.getVariant(vid).layoutId).toBe('awesome-cv');
    db.setVariantLayout(vid, null);
    expect(db.getVariant(vid).layoutId).toBe(null);
  });

  it('deleting a layout reverts referencing variants to the default (null)', () => {
    db.upsertLayout({ id: 'temp', name: 'Temp', kinds: ['cv'], source: 'upload' });
    const vid = db.createVariant(pid, 'CV', 'cv');
    db.setVariantLayout(vid, 'temp');
    expect(db.getVariant(vid).layoutId).toBe('temp');
    db.deleteLayout('temp');
    expect(db.getLayout('temp')).toBe(null);
    expect(db.getVariant(vid).layoutId).toBe(null);
  });
});

describe('selectLayout resolution order', () => {
  it('uses the variant layout_id when set', () => {
    const sel = selectLayout(db, { layoutId: 'awesome-cv', kind: 'cv' });
    expect(sel.id).toBe('awesome-cv');
    expect(sel.dir).toBe(path.join(BUILTIN_LAYOUTS_DIR, 'awesome-cv'));
    expect(sel.fallback).toBe(false);
  });

  it('falls back to the global default when the variant has none', () => {
    const sel = selectLayout(db, { layoutId: null, kind: 'cv' });
    expect(sel.id).toBe('awesome-cv');
  });

  it('skips a layout that does not support the variant kind', () => {
    db.upsertLayout({ id: 'cvonly', name: 'CV Only', kinds: ['cv'], source: 'upload' });
    const sel = selectLayout(db, { layoutId: 'cvonly', kind: 'coverletter' });
    expect(sel.id).toBe('awesome-cv'); // fell through to default
  });

  it('falls back to the builtin on disk when nothing resolves', () => {
    const empty = new CvDatabase(':memory:');
    empty.clearAllContent(); // no layouts seeded, no default
    const sel = selectLayout(empty, { layoutId: 'ghost', kind: 'cv' });
    expect(sel.id).toBe('awesome-cv');
    expect(sel.fallback).toBe(true);
    empty.close();
  });
});
