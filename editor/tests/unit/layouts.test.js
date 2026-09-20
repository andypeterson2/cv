/**
 * Layout persistence + selection, per account.
 *
 * A builtin carries a null owner and is visible to everyone; an upload belongs to the
 * account that installed it. `variants.layout_id` is a plain TEXT reference with no
 * ownership constraint, so selectLayout's visibility check is the only thing keeping a
 * variant from compiling with another account's templates.
 */
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');
const { selectLayout } = require('../../lib/render/select');
const { BUILTIN_LAYOUTS_DIR } = require('../../lib/render/layouts');
const path = require('path');

let db;
let pid;
let owner;
let other;

beforeEach(() => {
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  owner = db.ownerUserId();
  other = db.upsertUser({ googleSub: 'g-other', email: 'other@example.test' });
  pid = db.createPerson('Test Person');
});

afterEach(() => db.close());

describe('seedBuiltinLayouts', () => {
  it('registers awesome-cv as a builtin every account can see', () => {
    for (const uid of [owner, other]) {
      const awesome = db.listLayouts(uid).find((l) => l.id === 'awesome-cv');
      expect(awesome).toBeTruthy();
      expect(awesome.source).toBe('builtin');
      expect(awesome.builtin).toBe(true);
      expect(awesome.kinds).toEqual(expect.arrayContaining(['cv', 'resume', 'coverletter']));
    }
  });

  it('writes no default row, and the selector still lands on the builtin', () => {
    expect(db.getDefaultLayoutId(owner)).toBe(null);
    expect(selectLayout(db, { layoutId: null, kind: 'cv' }, owner).id).toBe('awesome-cv');
  });

  it('is idempotent and records a checksum', () => {
    const before = db.getLayout('awesome-cv', owner).checksum;
    seedBuiltinLayouts(db);
    seedBuiltinLayouts(db);
    expect(db.listLayouts(owner).filter((l) => l.id === 'awesome-cv')).toHaveLength(1);
    expect(db.getLayout('awesome-cv', owner).checksum).toBe(before);
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
    db.upsertLayout({ id: 'temp', name: 'Temp', kinds: ['cv'], source: 'upload', userId: owner });
    const vid = db.createVariant(pid, 'CV', 'cv');
    db.setVariantLayout(vid, 'temp');
    expect(db.getVariant(vid).layoutId).toBe('temp');
    expect(db.deleteLayout('temp', owner)).toBe(true);
    expect(db.getLayout('temp', owner)).toBe(null);
    expect(db.getVariant(vid).layoutId).toBe(null);
  });
});

describe('per-account visibility', () => {
  const mine = () => ({ id: 'mine', name: 'Mine', kinds: ['cv'], source: 'upload', userId: owner });

  it('an upload is invisible to another account', () => {
    db.upsertLayout(mine());
    expect(db.getLayout('mine', owner)).toBeTruthy();
    expect(db.getLayout('mine', other)).toBe(null);
    expect(db.listLayouts(other).map((l) => l.id)).not.toContain('mine');
    expect(db.listLayouts(owner).map((l) => l.id)).toContain('mine');
  });

  it('another account cannot delete it, and the owner can', () => {
    db.upsertLayout(mine());
    expect(db.deleteLayout('mine', other)).toBe(false);
    expect(db.getLayout('mine', owner)).toBeTruthy();
    expect(db.deleteLayout('mine', owner)).toBe(true);
    expect(db.getLayout('mine', owner)).toBe(null);
  });

  it('the scoped delete never removes a builtin', () => {
    expect(db.deleteLayout('awesome-cv', owner)).toBe(false);
    expect(db.deleteLayout('awesome-cv', null)).toBe(false);
    expect(db.getLayout('awesome-cv', owner)).toBeTruthy();
  });

  it('a namespaced id is opaque — the prefix is not authorisation', () => {
    db.upsertLayout({ ...mine(), id: `u${owner}-mine` });
    expect(db.getLayout(`u${owner}-mine`, other)).toBe(null);
    expect(db.getLayout(`u${other}-mine`, other)).toBe(null);
  });

  it('defaults do not cross accounts', () => {
    db.upsertLayout(mine());
    db.setDefaultLayoutId('mine', owner);
    expect(db.getDefaultLayoutId(owner)).toBe('mine');
    expect(db.getDefaultLayoutId(other)).toBe(null);
  });
});

describe('selectLayout resolution order', () => {
  it('uses the variant layout_id when set', () => {
    const sel = selectLayout(db, { layoutId: 'awesome-cv', kind: 'cv' }, owner);
    expect(sel.id).toBe('awesome-cv');
    expect(sel.dir).toBe(path.join(BUILTIN_LAYOUTS_DIR, 'awesome-cv'));
    expect(sel.fallback).toBe(false);
  });

  it("falls back to the account's default when the variant has none", () => {
    db.upsertLayout({ id: 'mine', name: 'Mine', kinds: ['cv'], source: 'upload', userId: owner });
    db.setDefaultLayoutId('mine', owner);
    expect(selectLayout(db, { layoutId: null, kind: 'cv' }, owner).id).toBe('mine');
    expect(selectLayout(db, { layoutId: null, kind: 'cv' }, other).id).toBe('awesome-cv');
  });

  it('skips a layout that does not support the variant kind', () => {
    db.upsertLayout({
      id: 'cvonly',
      name: 'CV Only',
      kinds: ['cv'],
      source: 'upload',
      userId: owner,
    });
    const sel = selectLayout(db, { layoutId: 'cvonly', kind: 'coverletter' }, owner);
    expect(sel.id).toBe('awesome-cv'); // fell through to default
  });

  it("will not compile a variant with another account's layout", () => {
    // A row like this can only predate migration 024; layout_id carries no
    // ownership constraint of its own, so the check has to happen here.
    db.upsertLayout({
      id: 'theirs',
      name: 'Theirs',
      kinds: ['cv'],
      source: 'upload',
      userId: other,
    });
    const vid = db.createVariant(pid, 'CV', 'cv');
    db.setVariantLayout(vid, 'theirs');
    const sel = selectLayout(db, db.getVariant(vid), owner);
    expect(sel.id).toBe('awesome-cv');
    expect(sel.dir).toBe(path.join(BUILTIN_LAYOUTS_DIR, 'awesome-cv'));
  });

  it('falls back to the builtin on disk when nothing resolves', () => {
    const empty = new CvDatabase(':memory:');
    empty.clearAllContent(); // no layouts seeded, no default
    const sel = selectLayout(empty, { layoutId: 'ghost', kind: 'cv' }, empty.ownerUserId());
    expect(sel.id).toBe('awesome-cv');
    expect(sel.fallback).toBe(true);
    empty.close();
  });
});
