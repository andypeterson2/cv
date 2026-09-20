/**
 * The ownership layer under `persons`: these pin per-user isolation at the data
 * layer, which is the property the whole feature rests on.
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

    // Cross-user reads return null, so nothing leaks about what exists.
    expect(db.getPersonForUser(pb, a)).toBeNull();
    expect(db.getMainForUser(pb, a)).toBeNull();
    expect(db.getMainForUser(pb, b)).toBeTruthy();
    expect(db.personUserId(pb)).toBe(b);

    // Cross-user writes no-op; the owner's writes take effect.
    expect(db.renamePersonForUser(pb, 'hijacked', a)).toBe(false);
    expect(db.renamePersonForUser(pb, 'renamed', b)).toBe(true);
    expect(db.getPersonForUser(pb, b).name).toBe('renamed');

    // A stranger's delete no-ops; the owner's removes the person.
    expect(db.deletePersonForUser(pb, a)).toBe(false);
    expect(db.getPersonForUser(pb, b)).toBeTruthy();
    expect(db.deletePersonForUser(pb, b)).toBe(true);
    expect(db.getPersonForUser(pb, b)).toBeNull();
  });

  test('upsertUser creates a row, then updates the profile for the same google_sub', () => {
    const id1 = db.upsertUser({ googleSub: 'sub-x', email: 'x@a.com', name: 'X' });
    const id2 = db.upsertUser({ googleSub: 'sub-x', email: 'x@b.com', name: 'X renamed' });
    expect(id2).toBe(id1); // same account
    expect(db.getUser(id1).email).toBe('x@b.com');
    expect(db.getUser(id1).name).toBe('X renamed');
  });
});

describe('attachUser — resolving the request user', () => {
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
    // X-User-Id without the secret is not trusted → falls back to the token path
    // (no bearer token here, so the demo/system user answers)
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

describe('multi-tenancy — owner adoption', () => {
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

    const uid = db.upsertUser({
      googleSub: 'google-real-123',
      email: 'ME@example.com',
      name: 'Me',
    });
    expect(uid).toBe(ownerId); // the same account answers
    expect(db.getUser(ownerId).google_sub).toBe('google-real-123'); // relinked to Google
    expect(db.getUser(ownerId).name).toBe('Me');
    // The pre-existing résumé is still theirs, and the role-based lookup still resolves.
    expect(db.personUserId(mine)).toBe(ownerId);
    expect(db.ownerUserId()).toBe(ownerId);
    expect(db.getPersonsForUser(uid).map((p) => p.id)).toContain(mine);
  });

  test('a second owner sign-in is a normal profile update, not a new account', () => {
    process.env.OWNER_EMAIL = 'me@example.com';
    const first = db.upsertUser({
      googleSub: 'google-real-123',
      email: 'me@example.com',
      name: 'Me',
    });
    const second = db.upsertUser({
      googleSub: 'google-real-123',
      email: 'me@example.com',
      name: 'Me Again',
    });
    expect(second).toBe(first);
    expect(db.getUser(first).name).toBe('Me Again');
  });

  test('a non-owner email never adopts — it gets its own fresh account', () => {
    process.env.OWNER_EMAIL = 'me@example.com';
    const ownerId = db.ownerUserId();
    const uid = db.upsertUser({
      googleSub: 'stranger-sub',
      email: 'stranger@example.com',
      name: 'S',
    });
    expect(uid).not.toBe(ownerId);
    expect(db.getUser(ownerId).google_sub).toBe('@owner'); // untouched
  });

  test('late adoption: an owner who signed in BEFORE OWNER_EMAIL was set is folded in on re-login', () => {
    const ownerId = db.ownerUserId();
    const pre = db.createPerson('My real CV'); // owner's pre-existing résumé

    // 1. Owner signs in while OWNER_EMAIL is unset → a stray ordinary account, no adoption.
    delete process.env.OWNER_EMAIL;
    const strayId = db.upsertUser({
      googleSub: 'google-real-123',
      email: 'me@example.com',
      name: 'Me',
    });
    expect(strayId).not.toBe(ownerId);
    const theirs = db.createPerson('Draft made on the stray account', strayId);
    expect(db.getUser(ownerId).google_sub).toBe('@owner'); // placeholder still unclaimed

    // 2. OWNER_EMAIL gets configured; the same Google account signs in again.
    process.env.OWNER_EMAIL = 'me@example.com';
    const uid = db.upsertUser({
      googleSub: 'google-real-123',
      email: 'ME@example.com',
      name: 'Me',
    });

    // Folded into @owner: same id, relinked, stray removed, all résumés under the owner.
    expect(uid).toBe(ownerId);
    expect(db.getUser(ownerId).google_sub).toBe('google-real-123');
    expect(db.getUserByGoogleSub('google-real-123').id).toBe(ownerId); // later logins hit the owner
    expect(db.getUser(strayId)).toBeNull(); // stray account gone
    const mine = db.getPersonsForUser(ownerId).map((p) => p.id);
    expect(mine).toContain(pre); // the pre-existing owner résumé
    expect(mine).toContain(theirs); // and anything made under the stray account
    expect(db.ownerUserId()).toBe(ownerId);
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
    // A is exhausted for the day, B is independent, and A resets the next day.
    expect(db.bumpCompileQuota(a, 2, '2026-08-18').ok).toBe(false);
    expect(db.bumpCompileQuota(b, 2, '2026-08-18').ok).toBe(true);
    expect(db.bumpCompileQuota(a, 2, '2026-08-19').ok).toBe(true);
  });
});

describe('per-user résumé-name uniqueness (migration 020)', () => {
  test('two accounts can share a résumé name; one account still cannot duplicate its own', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com', name: 'A' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com', name: 'B' });
    const pa = db.createPerson('Resume', a);
    const pb = db.createPerson('Resume', b); // same name, different account → allowed now (was a global-UNIQUE conflict)
    expect(pa).not.toBe(pb);
    expect(db.getPersonForUser(pa, a).name).toBe('Resume');
    expect(db.getPersonForUser(pb, b).name).toBe('Resume');
    expect(() => db.createPerson('Resume', a)).toThrow(/UNIQUE/); // same account → still rejected (app maps this to a 409)
  });

  test('the rebuild preserves persons + ids and keeps child FKs bound', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../migrations');
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    // Apply every migration before 020, so persons still has the OLD global UNIQUE(name).
    raw.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => (x.endsWith('.sql') || x.endsWith('.js')) && !x.includes('rollback'))
      .sort()) {
      if (parseInt(f, 10) >= 20) break;
      if (f.endsWith('.sql')) raw.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      else require(path.join(dir, f))(raw);
      raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    }
    // Seed two accounts, two persons, and a child section under the first person.
    raw
      .prepare(
        "INSERT INTO users (google_sub, email, name, role) VALUES ('u1','1',NULL,'user'),('u2','2',NULL,'user')",
      )
      .run();
    const u1 = raw.prepare("SELECT id FROM users WHERE google_sub='u1'").get().id;
    const u2 = raw.prepare("SELECT id FROM users WHERE google_sub='u2'").get().id;
    raw.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Alpha', u1);
    raw.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Beta', u2);
    const pAlpha = raw.prepare("SELECT id FROM persons WHERE name='Alpha'").get().id;
    raw
      .prepare('INSERT INTO sections (person_id, slug, type) VALUES (?, ?, ?)')
      .run(pAlpha, 'summary', 'summary');

    require('../../migrations/020_persons_per_user_unique')(raw);

    // Rows, ids, and columns survive; the child still points at its person; no dangling FKs.
    expect(raw.prepare('SELECT COUNT(*) AS n FROM persons').get().n).toBe(2);
    expect(raw.prepare('SELECT name, user_id FROM persons WHERE id = ?').get(pAlpha)).toEqual({
      name: 'Alpha',
      user_id: u1,
    });
    expect(raw.prepare('SELECT person_id FROM sections').get().person_id).toBe(pAlpha);
    expect(raw.pragma('foreign_key_check').length).toBe(0);
    // And the new constraint is live: cross-account dup ok, same-account dup rejected.
    expect(() =>
      raw.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Alpha', u2),
    ).not.toThrow();
    expect(() =>
      raw.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Alpha', u1),
    ).toThrow(/UNIQUE/);
    raw.close();
  });
});

describe('per-user settings (migration 023)', () => {
  test("one account's style never reaches another's", () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com' });
    db.setSettings({ 'style.accentColor': 'awesome-red' }, a);
    expect(db.getSettings('style', a)).toEqual({ 'style.accentColor': 'awesome-red' });
    expect(db.getSettings('style', b)).toEqual({});
  });

  test('both accounts can hold the same key at once', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com' });
    db.setSettings({ 'style.accentColor': 'awesome-red' }, a);
    db.setSettings({ 'style.accentColor': 'awesome-pink' }, b);
    expect(db.getSettings('style', a)['style.accentColor']).toBe('awesome-red');
    expect(db.getSettings('style', b)['style.accentColor']).toBe('awesome-pink');
  });

  test('a {num, unit} value round-trips per account', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com' });
    db.setSettings({ 'spacing.sectionGap': { num: 1.5, unit: 'em' } }, a);
    const row = db.db
      .prepare('SELECT value, value_num, value_unit FROM settings WHERE user_id = ? AND key = ?')
      .get(a, 'spacing.sectionGap');
    expect(row).toEqual({ value: '1.5em', value_num: 1.5, value_unit: 'em' });
  });

  test('an account with no rows resolves a document to the style defaults', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com' });
    const pid = db.createPerson('Theirs', a);
    db.createSection(pid, 'exp', 'experience', 'Experience');
    expect(db.resolveMain(pid).style).toEqual({});
  });

  test('a document renders with its own owner’s style, whoever asks', () => {
    const a = db.upsertUser({ googleSub: 'sub-a', email: 'a@x.com' });
    const b = db.upsertUser({ googleSub: 'sub-b', email: 'b@x.com' });
    db.setSettings({ 'style.accentColor': 'awesome-red' }, a);
    db.setSettings({ 'style.accentColor': 'awesome-pink' }, b);
    const pid = db.createPerson('Theirs', a);
    const sid = db.createSection(pid, 'exp', 'experience', 'Experience');
    db.createEntry(sid, { title: 'T' });
    expect(db.resolveMain(pid).style.accentColor).toBe('awesome-red');
  });

  test('adoption carries the stray account’s settings, and the owner’s keys win', () => {
    process.env.OWNER_EMAIL = 'me@x.com';
    try {
      const stray = db.upsertUser({ googleSub: 'g-stray', email: 'me@x.com' });
      db.setSettings({ 'style.accentColor': 'awesome-pink', 'style.fontSize': '11pt' }, stray);
      const ownerId = db.ownerUserId();
      db.setSettings({ 'style.accentColor': 'awesome-red' }, ownerId);
      // Signing in again with OWNER_EMAIL set folds the stray into '@owner'.
      expect(db.upsertUser({ googleSub: 'g-stray', email: 'me@x.com' })).toBe(ownerId);
      const after = db.getSettings('style', ownerId);
      expect(after['style.accentColor']).toBe('awesome-red'); // the owner's own key wins
      expect(after['style.fontSize']).toBe('11pt'); // the stray's other key carried across
    } finally {
      delete process.env.OWNER_EMAIL;
    }
  });

  test('the rebuild preserves values and re-keys them onto both sentinels', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../migrations');
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    raw.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    // Every migration before 023, so `settings` still has the old key-only PK.
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => (x.endsWith('.sql') || x.endsWith('.js')) && !x.includes('rollback'))
      .sort()) {
      if (parseInt(f, 10) >= 23) break;
      if (f.endsWith('.sql')) raw.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      else require(path.join(dir, f))(raw);
      raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    }
    raw
      .prepare('INSERT INTO settings (key, value, value_num, value_unit) VALUES (?, ?, ?, ?)')
      .run('spacing.sectionGap', '1.5em', 1.5, 'em');
    raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style.accentColor', 'red');
    const before = raw.prepare('SELECT COUNT(*) AS n FROM settings').get().n;

    require('../../migrations/023_settings_per_user')(raw);

    const ownerId = raw.prepare("SELECT id FROM users WHERE role='owner'").get().id;
    const systemId = raw.prepare("SELECT id FROM users WHERE role='system'").get().id;
    expect(raw.prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(before * 2);
    for (const uid of [ownerId, systemId]) {
      expect(
        raw
          .prepare(
            'SELECT value, value_num, value_unit FROM settings WHERE user_id = ? AND key = ?',
          )
          .get(uid, 'spacing.sectionGap'),
      ).toEqual({ value: '1.5em', value_num: 1.5, value_unit: 'em' });
    }
    expect(raw.pragma('foreign_key_check').length).toBe(0);
    // The unit CHECK survives the rebuild, and the new key admits one row per account.
    expect(() =>
      raw
        .prepare('INSERT INTO settings (user_id, key, value_unit) VALUES (?, ?, ?)')
        .run(ownerId, 'spacing.other', 'xx'),
    ).toThrow(/CHECK/);
    expect(() =>
      raw.prepare('INSERT INTO settings (user_id, key) VALUES (?, ?)').run(ownerId, 'style.new'),
    ).not.toThrow();
    expect(() =>
      raw.prepare('INSERT INTO settings (user_id, key) VALUES (?, ?)').run(ownerId, 'style.new'),
    ).toThrow(/UNIQUE|PRIMARY/);
    raw.close();
  });
});

describe('per-user layouts (migration 024)', () => {
  test('builtins stay ownerless and uploads go to the owner', () => {
    require('../../lib/render/seed').seedBuiltinLayouts(db);
    const ownerId = db.ownerUserId();
    db.upsertLayout({ id: 'mine', name: 'Mine', kinds: ['cv'], source: 'upload', userId: ownerId });
    expect(db.getLayout('awesome-cv', ownerId).userId).toBe(null);
    expect(db.getLayout('mine', ownerId).userId).toBe(ownerId);
  });

  test('a variant bound to another account’s layout is severed by the backfill', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../migrations');
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    raw.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => (x.endsWith('.sql') || x.endsWith('.js')) && !x.includes('rollback'))
      .sort()) {
      if (parseInt(f, 10) >= 24) break;
      if (f.endsWith('.sql')) raw.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      else require(path.join(dir, f))(raw);
      raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    }
    const ownerId = raw.prepare("SELECT id FROM users WHERE role='owner'").get().id;
    raw.prepare("INSERT INTO users (google_sub, email, role) VALUES ('g-o','o@x','user')").run();
    const otherId = raw.prepare("SELECT id FROM users WHERE google_sub='g-o'").get().id;
    raw
      .prepare("INSERT INTO layouts (id, name, kinds, source) VALUES ('shared','S','[]','upload')")
      .run();
    raw.prepare('INSERT INTO persons (name, user_id) VALUES (?, ?)').run('Theirs', otherId);
    const pid = raw.prepare("SELECT id FROM persons WHERE name='Theirs'").get().id;
    raw
      .prepare("INSERT INTO variants (person_id, name, kind, layout_id) VALUES (?,?,'cv','shared')")
      .run(pid, 'V');

    require('../../migrations/024_layouts_per_user')(raw);

    // The layout belongs to the owner after the backfill; the variant's person does not.
    expect(raw.prepare("SELECT user_id FROM layouts WHERE id='shared'").get().user_id).toBe(
      ownerId,
    );
    expect(raw.prepare('SELECT layout_id FROM variants').get().layout_id).toBe(null);
    expect(raw.pragma('foreign_key_check').length).toBe(0);
    raw.close();
  });
});
