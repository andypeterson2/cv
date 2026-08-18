/**
 * Multi-tenancy phase 1 (migration 018): the ownership layer under `persons`.
 * These pin per-user ISOLATION at the data layer — the property the whole
 * feature rests on — before any real auth exists.
 */
const CvDatabase = require('../../lib/db');
const { attachUser } = require('../../lib/current-user');

let db;
beforeEach(() => {
  db = new CvDatabase(':memory:');
});
afterEach(() => {
  db.close();
});

describe('multi-tenancy — accounts + backfill', () => {
  test('migration seeds the @system and @owner sentinel accounts', () => {
    const system = db.getUserByGoogleSub('@system');
    const owner = db.getUserByGoogleSub('@owner');
    expect(system.role).toBe('system');
    expect(owner.role).toBe('owner');
    expect(db.systemUserId()).toBe(system.id);
    expect(db.ownerUserId()).toBe(owner.id);
  });

  test('the seeded demo (Jane Doe) belongs to @system, not the owner', () => {
    const jane = db.getPersons().find((p) => p.name === 'Jane Doe');
    expect(jane).toBeTruthy();
    expect(db.personUserId(jane.id)).toBe(db.systemUserId());
  });

  test('createPerson defaults ownership to the owner account', () => {
    const pid = db.createPerson('My CV');
    expect(db.personUserId(pid)).toBe(db.ownerUserId());
  });
});

describe('multi-tenancy — per-user isolation', () => {
  test('a user only sees, reads, renames, and deletes their own persons', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com', name: 'A' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com', name: 'B' });
    const pa = db.createPerson('A resume', a);
    const pb = db.createPerson('B resume', b);

    // List scoping — each user sees only their own.
    expect(db.getPersonsForUser(a).map((p) => p.id)).toEqual([pa]);
    expect(db.getPersonsForUser(b).map((p) => p.id)).toEqual([pb]);

    // Cross-user reads are INVISIBLE (null, not a 403 — no existence leak).
    expect(db.getPersonForUser(pb, a)).toBeNull();
    expect(db.getMainForUser(pb, a)).toBeNull();
    expect(db.getMainForUser(pb, b)).toBeTruthy();
    expect(db.personUserId(pb)).toBe(b);

    // Cross-user writes no-op; the owner's writes take effect.
    expect(db.renamePersonForUser(pb, 'hijacked', a)).toBe(false);
    expect(db.renamePersonForUser(pb, 'renamed', b)).toBe(true);
    expect(db.getPersonForUser(pb, b).name).toBe('renamed');

    expect(db.deletePersonForUser(pb, a)).toBe(false); // stranger can't delete
    expect(db.getPersonForUser(pb, b)).toBeTruthy(); // still there
    expect(db.deletePersonForUser(pb, b)).toBe(true); // owner can
    expect(db.getPersonForUser(pb, b)).toBeNull(); // gone
  });

  test('upsertUser creates a row, then updates the profile for the same google_sub', () => {
    const id1 = db.upsertUser({ googleSub: 'sub-x', email: 'x@a.com', name: 'X' });
    const id2 = db.upsertUser({ googleSub: 'sub-x', email: 'x@b.com', name: 'X renamed' });
    expect(id2).toBe(id1); // same account
    expect(db.getUser(id1).email).toBe('x@b.com');
    expect(db.getUser(id1).name).toBe('X renamed');
  });
});

describe('attachUser seam — resolving the request user (phase 2)', () => {
  const mkReq = (headers) => ({ headers, get: (n) => headers[n.toLowerCase()] });
  const run = (mw, req) => {
    let called = false;
    mw(req, {}, () => {
      called = true;
    });
    return called;
  };

  test('trusts X-User-Id ONLY when the front-door secret matches', () => {
    const mw = attachUser(() => db, { token: 'the-token', originSecret: 'front-door' });
    // valid front door → the injected user id wins
    const good = mkReq({ 'x-user-id': '77', 'x-origin-secret': 'front-door' });
    expect(run(mw, good)).toBe(true);
    expect(good.userId).toBe(77);
    // X-User-Id without the secret is NOT trusted → falls back to the token path
    // (no bearer token here → the demo/system user, not the claimed 77)
    const spoof = mkReq({ 'x-user-id': '77' });
    run(mw, spoof);
    expect(spoof.userId).toBe(db.systemUserId());
    expect(spoof.userId).not.toBe(77);
  });

  test('legacy owner-token path still resolves to the owner', () => {
    const mw = attachUser(() => db, { token: 'the-token', originSecret: 'front-door' });
    const req = mkReq({ authorization: 'Bearer the-token' });
    run(mw, req);
    expect(req.userId).toBe(db.ownerUserId());
  });

  test('no token configured (local dev / tests) → the owner', () => {
    const mw = attachUser(() => db, { token: '', originSecret: '' });
    const req = mkReq({});
    run(mw, req);
    expect(req.userId).toBe(db.ownerUserId());
  });
});

describe('multi-tenancy — owner adoption (phase 2)', () => {
  const prev = process.env.OWNER_EMAIL;
  afterEach(() => {
    if (prev === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = prev;
  });

  test('first sign-in matching OWNER_EMAIL adopts the @owner account AND its résumés', () => {
    process.env.OWNER_EMAIL = 'me@example.com';
    const ownerId = db.ownerUserId();
    const mine = db.createPerson('My real CV'); // defaults to the owner account
    expect(db.getUser(ownerId).google_sub).toBe('@owner');

    const uid = db.upsertUser({ googleSub: 'google-real-123', email: 'ME@example.com', name: 'Me' });
    expect(uid).toBe(ownerId); // same account, not a new one
    expect(db.getUser(ownerId).google_sub).toBe('google-real-123'); // relinked to Google
    expect(db.getUser(ownerId).name).toBe('Me');
    // The pre-existing résumé is still theirs, and the role-based lookup still resolves.
    expect(db.personUserId(mine)).toBe(ownerId);
    expect(db.ownerUserId()).toBe(ownerId);
    expect(db.getPersonsForUser(uid).map((p) => p.id)).toContain(mine);
  });

  test('a second owner sign-in is a normal profile update, not a new account', () => {
    process.env.OWNER_EMAIL = 'me@example.com';
    const first = db.upsertUser({ googleSub: 'google-real-123', email: 'me@example.com', name: 'Me' });
    const second = db.upsertUser({ googleSub: 'google-real-123', email: 'me@example.com', name: 'Me Again' });
    expect(second).toBe(first);
    expect(db.getUser(first).name).toBe('Me Again');
  });

  test('a non-owner email never adopts — it gets its own fresh account', () => {
    process.env.OWNER_EMAIL = 'me@example.com';
    const ownerId = db.ownerUserId();
    const uid = db.upsertUser({ googleSub: 'stranger-sub', email: 'stranger@example.com', name: 'S' });
    expect(uid).not.toBe(ownerId);
    expect(db.getUser(ownerId).google_sub).toBe('@owner'); // untouched
  });

  test('late adoption: an owner who signed in BEFORE OWNER_EMAIL was set is folded in on re-login', () => {
    const ownerId = db.ownerUserId();
    const pre = db.createPerson('My real CV'); // owner's pre-existing résumé

    // 1. Owner signs in while OWNER_EMAIL is unset → a stray ordinary account, no adoption.
    delete process.env.OWNER_EMAIL;
    const strayId = db.upsertUser({ googleSub: 'google-real-123', email: 'me@example.com', name: 'Me' });
    expect(strayId).not.toBe(ownerId);
    const theirs = db.createPerson('Draft made on the stray account', strayId);
    expect(db.getUser(ownerId).google_sub).toBe('@owner'); // placeholder still unclaimed

    // 2. OWNER_EMAIL gets configured; the same Google account signs in again.
    process.env.OWNER_EMAIL = 'me@example.com';
    const uid = db.upsertUser({ googleSub: 'google-real-123', email: 'ME@example.com', name: 'Me' });

    // Folded into @owner: same id, relinked, stray removed, ALL résumés under the owner.
    expect(uid).toBe(ownerId);
    expect(db.getUser(ownerId).google_sub).toBe('google-real-123');
    expect(db.getUserByGoogleSub('google-real-123').id).toBe(ownerId); // later logins hit the owner
    expect(db.getUser(strayId)).toBeNull(); // stray account gone
    const mine = db.getPersonsForUser(ownerId).map((p) => p.id);
    expect(mine).toContain(pre); // the pre-existing owner résumé
    expect(mine).toContain(theirs); // and anything made under the stray account
    expect(db.ownerUserId()).toBe(ownerId); // role-based lookup still resolves
  });
});

describe('per-user compile quota (migration 019)', () => {
  test('counts compiles and blocks at the cap without over-counting', () => {
    const uid = db.upsertUser({ googleSub: 'sub-c', email: 'c@x.com', name: 'C' });
    const day = '2026-08-18';
    expect(db.bumpCompileQuota(uid, 3, day)).toEqual({ ok: true, used: 1, limit: 3 });
    expect(db.bumpCompileQuota(uid, 3, day)).toEqual({ ok: true, used: 2, limit: 3 });
    expect(db.bumpCompileQuota(uid, 3, day)).toEqual({ ok: true, used: 3, limit: 3 });
    // Over the cap: blocked, and the block neither runs a compile nor inflates the count.
    expect(db.bumpCompileQuota(uid, 3, day)).toEqual({ ok: false, used: 3, limit: 3 });
    expect(db.bumpCompileQuota(uid, 3, day)).toEqual({ ok: false, used: 3, limit: 3 });
  });

  test('the quota is per-user and per-UTC-day', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com', name: 'A' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com', name: 'B' });
    db.bumpCompileQuota(a, 2, '2026-08-18');
    db.bumpCompileQuota(a, 2, '2026-08-18');
    expect(db.bumpCompileQuota(a, 2, '2026-08-18').ok).toBe(false); // A exhausted for the day
    expect(db.bumpCompileQuota(b, 2, '2026-08-18').ok).toBe(true); // B is independent
    expect(db.bumpCompileQuota(a, 2, '2026-08-19').ok).toBe(true); // A resets the next day
  });
});
