/**
 * SQLite access layer for the CV Editor (normalized, stateless model).
 *
 * Single source of truth — every profile owns a main CV (sections → entries →
 * items, with free-string tags) plus named variants. A variant is a lightweight
 * overlay: a tag query (variant_rules) + sparse per-entry/item exceptions
 * (entry_overrides / item_overrides) + a section list (variant_sections), or —
 * for coverletter-kind variants — a list of letter paragraphs.
 *
 * There is no "active profile" and no JSON-blob working copy. All ids are stable
 * and every method takes the ids it operates on, so callers (REST, MCP) are
 * fully addressable and stateless.
 *
 * Style/spacing/fonts are per-user (the `settings` table, keyed on the account);
 * personal info is per-profile (`profile_settings`) and the cover-letter header is
 * per-variant. A document renders with its profile's owner's style, so what a
 * reader sees does not depend on who asked for it.
 */

const Database = require('better-sqlite3');
const runMigrations = require('./migration-runner');
const { normalizeType } = require('./latex-type-map');
const { rowToSection } = require('./db/helpers');
const { applyMixin } = require('./db/_mixin');

class CvDatabase {
  /**
   * @param {string} dbPath - Path to SQLite file, or ':memory:' for tests
   */
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
    this._prepareStatements();
    this.seedJaneDoe();
  }

  // Prepared statements

  _prepareStatements() {
    const p = (sql) => this.db.prepare(sql);
    this._stmts = {
      // Per-user settings (style/spacing/fonts)
      getSettings: p(
        "SELECT key, value, value_num, value_unit FROM settings WHERE user_id = ? AND key LIKE ? || '%'",
      ),
      upsertSetting: p(
        'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
      ),
      upsertSettingUnit: p(
        'INSERT INTO settings (user_id, key, value, value_num, value_unit) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, value_num = excluded.value_num, value_unit = excluded.value_unit',
      ),
      deleteSetting: p('DELETE FROM settings WHERE user_id = ? AND key = ?'),
      // Carried into the owner account when a stray account is adopted; the owner's
      // own keys win, so the copy cannot overwrite a value they already chose.
      copySettingsToUser: p(
        'INSERT OR IGNORE INTO settings (user_id, key, value, value_num, value_unit, value_legacy) SELECT ?, key, value, value_num, value_unit, value_legacy FROM settings WHERE user_id = ?',
      ),

      // Profile settings (personal.* / coverletter.*)
      getProfileSettings: p(
        "SELECT key, value, value_num, value_unit FROM profile_settings WHERE profile_id = ? AND key LIKE ? || '%'",
      ),
      upsertProfileSetting: p(
        'INSERT INTO profile_settings (profile_id, key, value) VALUES (?, ?, ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value',
      ),
      deleteProfileSetting: p('DELETE FROM profile_settings WHERE profile_id = ? AND key = ?'),

      // Profiles
      getProfiles: p('SELECT id, name, created_at FROM profiles ORDER BY id'),
      getProfile: p('SELECT id, name, created_at FROM profiles WHERE id = ?'),
      insertProfile: p('INSERT INTO profiles (name, user_id) VALUES (?, ?)'),
      updateProfileName: p('UPDATE profiles SET name = ? WHERE id = ?'),
      deleteProfile: p('DELETE FROM profiles WHERE id = ?'),
      countProfiles: p('SELECT COUNT(*) AS cnt FROM profiles'),
      // --- multi-tenancy (migration 018): ownership + per-user scoping ---
      profileUserId: p('SELECT user_id FROM profiles WHERE id = ?'),
      getProfilesForUser: p(
        'SELECT id, name, created_at FROM profiles WHERE user_id = ? ORDER BY id',
      ),
      getProfileForUser: p(
        'SELECT id, name, created_at FROM profiles WHERE id = ? AND user_id = ?',
      ),
      renameProfileForUser: p('UPDATE profiles SET name = ? WHERE id = ? AND user_id = ?'),
      deleteProfileForUser: p('DELETE FROM profiles WHERE id = ? AND user_id = ?'),
      insertUser: p('INSERT INTO users (google_sub, email, name, role) VALUES (?, ?, ?, ?)'),
      getUserById: p(
        'SELECT id, google_sub, email, name, role, created_at FROM users WHERE id = ?',
      ),
      getUserBySub: p(
        'SELECT id, google_sub, email, name, role, created_at FROM users WHERE google_sub = ?',
      ),
      getUserByEmail: p(
        'SELECT id, google_sub, email, name, role, created_at FROM users WHERE email = ?',
      ),
      updateUserProfile: p('UPDATE users SET email = ?, name = ? WHERE id = ?'),
      userIdByRole: p('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1'),
      adoptUser: p('UPDATE users SET google_sub = ?, email = ?, name = ? WHERE id = ?'),
      reassignProfiles: p('UPDATE profiles SET user_id = ? WHERE user_id = ?'),
      deleteUser: p('DELETE FROM users WHERE id = ?'),
      // Per-user compile quota (migration 019): count of compiles per user per UTC day.
      getCompileCount: p('SELECT count FROM compile_usage WHERE user_id = ? AND day = ?'),
      bumpCompileCount: p(
        'INSERT INTO compile_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1',
      ),

      // Versions + the per-profile content reset restore uses
      insertVersion: p(
        'INSERT INTO versions (profile_id, label, doc, created_at, branch, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      versionsByProfile: p(
        'SELECT id, label, created_at, branch, tag, parent_id FROM versions WHERE profile_id = ? ORDER BY id DESC',
      ),
      versionDoc: p('SELECT doc FROM versions WHERE id = ? AND profile_id = ?'),
      versionFull: p(
        'SELECT id, label, created_at, branch, tag, parent_id, doc FROM versions WHERE id = ? AND profile_id = ?',
      ),
      setVersionTag: p('UPDATE versions SET tag = ? WHERE id = ? AND profile_id = ?'),

      // LinkedIn/Indeed/Handshake sync (015): one synced fingerprint per experience entry.
      linkedinSyncByProfile: p(
        'SELECT entry_id, fingerprint, synced_at FROM linkedin_sync WHERE profile_id = ?',
      ),
      upsertLinkedinSync: p(
        'INSERT INTO linkedin_sync (profile_id, entry_id, fingerprint, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, entry_id) DO UPDATE SET fingerprint = excluded.fingerprint, synced_at = excluded.synced_at',
      ),

      // Owner-profile resolution for auth gating — id-addressed resources → their profile.
      ownerOfVariant: p('SELECT profile_id AS pid FROM variants WHERE id = ?'),
      ownerOfSection: p('SELECT profile_id AS pid FROM sections WHERE id = ?'),
      ownerOfEntry: p(
        'SELECT s.profile_id AS pid FROM entries e JOIN sections s ON s.id = e.section_id WHERE e.id = ?',
      ),
      ownerOfItem: p(
        'SELECT s.profile_id AS pid FROM items i JOIN entries e ON e.id = i.entry_id JOIN sections s ON s.id = e.section_id WHERE i.id = ?',
      ),
      clearSections: p('DELETE FROM sections WHERE profile_id = ?'),
      clearVariants: p('DELETE FROM variants WHERE profile_id = ?'),
      clearProfileSettings: p('DELETE FROM profile_settings WHERE profile_id = ?'),
      clearTagAliases: p('DELETE FROM tag_aliases WHERE profile_id = ?'),
      clearTagCatalog: p('DELETE FROM tag_catalog WHERE profile_id = ?'),

      // Sections
      getSectionsByProfile: p(
        'SELECT id, profile_id, slug, type, title, sort_order FROM sections WHERE profile_id = ? ORDER BY sort_order, id',
      ),
      getSection: p(
        'SELECT id, profile_id, slug, type, title, sort_order FROM sections WHERE id = ?',
      ),
      insertSection: p(
        'INSERT INTO sections (profile_id, slug, type, title, sort_order) VALUES (?, ?, ?, ?, ?)',
      ),
      updateSectionTitle: p('UPDATE sections SET title = ? WHERE id = ?'),
      updateSectionSlugType: p('UPDATE sections SET slug = ?, type = ?, title = ? WHERE id = ?'),
      updateSectionSortOrder: p('UPDATE sections SET sort_order = ? WHERE id = ?'),
      deleteSection: p('DELETE FROM sections WHERE id = ?'),
      maxSectionSortOrder: p(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM sections WHERE profile_id = ?',
      ),

      // Entries
      getEntries: p(
        'SELECT id, section_id, sort_order, fields FROM entries WHERE section_id = ? ORDER BY sort_order, id',
      ),
      getEntry: p('SELECT id, section_id, sort_order, fields FROM entries WHERE id = ?'),
      insertEntry: p('INSERT INTO entries (section_id, sort_order, fields) VALUES (?, ?, ?)'),
      updateEntryFields: p('UPDATE entries SET fields = ? WHERE id = ?'),
      // Scoped by parent so a reorder can only move rows inside the named section.
      updateEntrySortOrder: p('UPDATE entries SET sort_order = ? WHERE id = ? AND section_id = ?'),
      deleteEntry: p('DELETE FROM entries WHERE id = ?'),
      maxEntrySortOrder: p(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM entries WHERE section_id = ?',
      ),

      // Items
      getItems: p(
        'SELECT id, entry_id, sort_order, content, title FROM items WHERE entry_id = ? ORDER BY sort_order, id',
      ),
      getItem: p('SELECT id, entry_id, sort_order, content, title FROM items WHERE id = ?'),
      insertItem: p('INSERT INTO items (entry_id, sort_order, content, title) VALUES (?, ?, ?, ?)'),
      updateItemContent: p('UPDATE items SET content = ? WHERE id = ?'),
      updateItemTitle: p('UPDATE items SET title = ? WHERE id = ?'),
      // Scoped by parent so a reorder can only move rows inside the named entry.
      updateItemSortOrder: p('UPDATE items SET sort_order = ? WHERE id = ? AND entry_id = ?'),
      deleteItem: p('DELETE FROM items WHERE id = ?'),
      maxItemSortOrder: p(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM items WHERE entry_id = ?',
      ),

      // Tags
      getEntryTags: p('SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag'),
      addEntryTag: p('INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?, ?)'),
      delEntryTag: p('DELETE FROM entry_tags WHERE entry_id = ? AND tag = ?'),
      getItemTags: p('SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag'),
      addItemTag: p('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)'),
      delItemTag: p('DELETE FROM item_tags WHERE item_id = ? AND tag = ?'),
      listEntryTags: p(
        'SELECT DISTINCT et.tag FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?',
      ),
      listItemTags: p(
        'SELECT DISTINCT it.tag FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?',
      ),
      countEntryTags: p(
        'SELECT et.tag AS tag, COUNT(*) AS cnt FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ? GROUP BY et.tag',
      ),
      countItemTags: p(
        'SELECT it.tag AS tag, COUNT(*) AS cnt FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ? GROUP BY it.tag',
      ),
      profileForEntry: p(
        'SELECT s.profile_id AS pid FROM entries e JOIN sections s ON e.section_id = s.id WHERE e.id = ?',
      ),
      profileForItem: p(
        'SELECT s.profile_id AS pid FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE i.id = ?',
      ),

      // Tag aliases (per-profile alias → canonical)
      getAliases: p(
        'SELECT alias, canonical, source FROM tag_aliases WHERE profile_id = ? ORDER BY alias',
      ),
      getAlias: p('SELECT canonical FROM tag_aliases WHERE profile_id = ? AND alias = ?'),
      upsertAlias: p(
        'INSERT INTO tag_aliases (profile_id, alias, canonical, source) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, alias) DO UPDATE SET canonical = excluded.canonical, source = excluded.source',
      ),
      delAlias: p('DELETE FROM tag_aliases WHERE profile_id = ? AND alias = ?'),
      // Retroactive alias application: fold an existing tag into its canonical,
      // profile-scoped. UPDATE OR IGNORE moves rows that don't collide; the
      // paired DELETE clears any that did (the canonical already existed).
      rewriteEntryTag: p(
        'UPDATE OR IGNORE entry_tags SET tag = ? WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?)',
      ),
      delEntryTagP: p(
        'DELETE FROM entry_tags WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?)',
      ),
      rewriteItemTag: p(
        'UPDATE OR IGNORE item_tags SET tag = ? WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?)',
      ),
      delItemTagP: p(
        'DELETE FROM item_tags WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.profile_id = ?)',
      ),
      rewriteRuleTag: p(
        'UPDATE OR IGNORE variant_rules SET tag = ? WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE profile_id = ?)',
      ),
      delRuleTagP: p(
        'DELETE FROM variant_rules WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE profile_id = ?)',
      ),

      // Tag catalog (per-profile controlled vocabulary)
      getCatalog: p(
        'SELECT tag, description, category FROM tag_catalog WHERE profile_id = ? ORDER BY tag',
      ),
      upsertCatalogTag: p(
        'INSERT INTO tag_catalog (profile_id, tag, description, category) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, tag) DO UPDATE SET description = excluded.description, category = excluded.category',
      ),
      insertTagEvent: p(
        'INSERT INTO tag_events (profile_id, target, target_id, tag, action, rank) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      tagEventCounts: p(
        'SELECT action, rank, COUNT(*) AS n FROM tag_events WHERE profile_id = ? GROUP BY action, rank',
      ),
      insertCatalogTagIfAbsent: p(
        'INSERT OR IGNORE INTO tag_catalog (profile_id, tag, description, category) VALUES (?, ?, ?, ?)',
      ),
      delCatalogTag: p('DELETE FROM tag_catalog WHERE profile_id = ? AND tag = ?'),

      // Variants
      getVariants: p(
        'SELECT id, profile_id, name, kind, created_at, layout_id FROM variants WHERE profile_id = ? ORDER BY id',
      ),
      getVariant: p(
        'SELECT id, profile_id, name, kind, created_at, layout_id FROM variants WHERE id = ?',
      ),
      insertVariant: p('INSERT INTO variants (profile_id, name, kind) VALUES (?, ?, ?)'),
      updateVariantName: p('UPDATE variants SET name = ? WHERE id = ?'),
      setVariantLayout: p('UPDATE variants SET layout_id = ? WHERE id = ?'),
      clearVariantLayoutFor: p('UPDATE variants SET layout_id = NULL WHERE layout_id = ?'),
      deleteVariant: p('DELETE FROM variants WHERE id = ?'),

      // Layouts (bundle metadata; files live on disk). A builtin has user_id NULL,
      // which is what makes it visible to every account; an upload names its owner.
      listLayouts: p(
        "SELECT id, name, version, engine, kinds, status, source, checksum, created_at, verified_at FROM layouts WHERE user_id IS NULL OR user_id = ? ORDER BY (source = 'builtin') DESC, id",
      ),
      getLayout: p(
        'SELECT id, name, version, engine, kinds, status, source, manifest, checksum, report, created_at, verified_at, user_id FROM layouts WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
      ),
      upsertLayout:
        p(`INSERT INTO layouts (id, name, version, engine, kinds, status, source, manifest, checksum, report, verified_at, user_id)
        VALUES (@id, @name, @version, @engine, @kinds, @status, @source, @manifest, @checksum, @report, @verified_at, @user_id)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, version=excluded.version, engine=excluded.engine, kinds=excluded.kinds,
          status=excluded.status, source=excluded.source, manifest=excluded.manifest,
          checksum=excluded.checksum, report=excluded.report, verified_at=excluded.verified_at,
          user_id=excluded.user_id`),
      // `= ?` never matches a NULL owner, so the scoped delete cannot remove a
      // builtin however it is called.
      deleteLayout: p('DELETE FROM layouts WHERE id = ? AND user_id = ?'),
      // Unscoped — SYSTEM use only (the boot seed reconciling rows against disk).
      // Request handlers must go through the scoped pair above.
      listAllLayouts: p(
        "SELECT id, name, version, engine, kinds, status, source, checksum, created_at, verified_at FROM layouts ORDER BY (source = 'builtin') DESC, id",
      ),
      deleteLayoutUnscoped: p('DELETE FROM layouts WHERE id = ?'),
      getLayoutUnscoped: p(
        'SELECT id, name, version, engine, kinds, status, source, manifest, checksum, report, created_at, verified_at, user_id FROM layouts WHERE id = ?',
      ),

      // Variant rules
      getVariantRules: p('SELECT tag, mode FROM variant_rules WHERE variant_id = ?'),
      clearVariantRules: p('DELETE FROM variant_rules WHERE variant_id = ?'),
      insertVariantRule: p(
        'INSERT OR IGNORE INTO variant_rules (variant_id, tag, mode) VALUES (?, ?, ?)',
      ),

      // Variant sections
      getVariantSections: p(
        'SELECT section_id, enabled, sort_order FROM variant_sections WHERE variant_id = ? ORDER BY sort_order, section_id',
      ),
      clearVariantSections: p('DELETE FROM variant_sections WHERE variant_id = ?'),
      insertVariantSection: p(
        'INSERT OR IGNORE INTO variant_sections (variant_id, section_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
      ),

      // Overrides
      getEntryOverrides: p(
        'SELECT entry_id, included, text_override, sort_override, fields_override FROM entry_overrides WHERE variant_id = ?',
      ),
      upsertEntryOverride: p(
        'INSERT INTO entry_overrides (variant_id, entry_id, included, text_override, sort_override, fields_override) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(variant_id, entry_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override, fields_override = excluded.fields_override',
      ),
      deleteEntryOverride: p('DELETE FROM entry_overrides WHERE variant_id = ? AND entry_id = ?'),
      getItemOverrides: p(
        'SELECT item_id, included, text_override, sort_override FROM item_overrides WHERE variant_id = ?',
      ),
      upsertItemOverride: p(
        'INSERT INTO item_overrides (variant_id, item_id, included, text_override, sort_override) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, item_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override',
      ),
      deleteItemOverride: p('DELETE FROM item_overrides WHERE variant_id = ? AND item_id = ?'),

      // Variant letter sections
      getLetterSections: p(
        'SELECT id, sort_order, title, body FROM variant_letter_sections WHERE variant_id = ? ORDER BY sort_order, id',
      ),
      insertLetterSection: p(
        'INSERT INTO variant_letter_sections (variant_id, sort_order, title, body) VALUES (?, ?, ?, ?)',
      ),
      // Scoped by variant so a paragraph can only be touched through its own variant.
      updateLetterSection: p(
        'UPDATE variant_letter_sections SET title = ?, body = ? WHERE id = ? AND variant_id = ?',
      ),
      deleteLetterSection: p('DELETE FROM variant_letter_sections WHERE id = ? AND variant_id = ?'),
      updateLetterSectionOrder: p(
        'UPDATE variant_letter_sections SET sort_order = ? WHERE id = ? AND variant_id = ?',
      ),
      maxLetterSectionOrder: p(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM variant_letter_sections WHERE variant_id = ?',
      ),

      // Variant letter header (per-variant cover-letter header — see migration 011)
      getLetterHeader: p(
        'SELECT recipient_name, recipient_address, opening, closing FROM variant_letter_header WHERE variant_id = ?',
      ),
      upsertLetterHeader:
        p(`INSERT INTO variant_letter_header (variant_id, recipient_name, recipient_address, opening, closing)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(variant_id) DO UPDATE SET recipient_name = excluded.recipient_name, recipient_address = excluded.recipient_address, opening = excluded.opening, closing = excluded.closing`),

      // Per-variant personal.* overrides; key is unprefixed, absent means inherit
      getVariantPersonal: p('SELECT key, value FROM variant_personal WHERE variant_id = ?'),
      upsertVariantPersonal: p(
        'INSERT INTO variant_personal (variant_id, key, value) VALUES (?, ?, ?) ON CONFLICT(variant_id, key) DO UPDATE SET value = excluded.value',
      ),
      deleteVariantPersonal: p('DELETE FROM variant_personal WHERE variant_id = ? AND key = ?'),

      // Per-variant style/spacing/fonts overrides; key is prefixed, absent means inherit
      getVariantSettings: p(
        'SELECT key, value, value_num, value_unit FROM variant_settings WHERE variant_id = ?',
      ),
      upsertVariantSetting: p(
        'INSERT INTO variant_settings (variant_id, key, value, value_num, value_unit) VALUES (?, ?, ?, NULL, NULL) ON CONFLICT(variant_id, key) DO UPDATE SET value = excluded.value, value_num = NULL, value_unit = NULL',
      ),
      upsertVariantSettingUnit: p(
        'INSERT INTO variant_settings (variant_id, key, value, value_num, value_unit) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, key) DO UPDATE SET value = excluded.value, value_num = excluded.value_num, value_unit = excluded.value_unit',
      ),
      deleteVariantSetting: p('DELETE FROM variant_settings WHERE variant_id = ? AND key = ?'),
    };
  }

  // Settings methods (global + per-profile) are mixed in at the bottom of this file.

  // Profiles

  // users + ownership (migration 018)

  getUser(id) {
    return this._stmts.getUserById.get(id) || null;
  }
  getUserByGoogleSub(sub) {
    return this._stmts.getUserBySub.get(sub) || null;
  }
  getUserByEmail(email) {
    return this._stmts.getUserByEmail.get(email) || null;
  }
  /**
   * Create-or-update the user for a Google identity, returning its id.
   *
   * Owner adoption: the FIRST real sign-in whose email matches OWNER_EMAIL takes
   * over the '@owner' placeholder account (created by migration 018) instead of
   * making a fresh one — so your pre-existing résumés become owned by your real
   * Google account. It fires once: after adoption the owner row carries the real
   * `sub`, so later sign-ins match at the top as a normal profile update.
   */
  upsertUser({ googleSub, email = null, name = null, role = 'user' }) {
    const ownerEmail = process.env.OWNER_EMAIL;
    const isOwnerEmail = !!(
      email &&
      ownerEmail &&
      email.toLowerCase() === ownerEmail.toLowerCase()
    );
    const existing = this.getUserByGoogleSub(googleSub);
    if (existing) {
      // Late adoption: the owner may have signed in before OWNER_EMAIL was configured,
      // which made an ordinary user instead of taking over '@owner'. If this is the
      // owner's email and '@owner' is still an unclaimed placeholder, fold that stray
      // account into it now — same net effect as first-sign-in adoption, one-shot.
      if (isOwnerEmail && existing.role !== 'owner') {
        const adopted = this._adoptStrayIntoOwner(existing, { googleSub, email, name });
        if (adopted != null) return adopted;
      }
      this._stmts.updateUserProfile.run(email, name, existing.id);
      return existing.id;
    }
    if (isOwnerEmail) {
      const ownerId = this.ownerUserId();
      const owner = ownerId != null ? this.getUser(ownerId) : null;
      if (owner && owner.google_sub === '@owner') {
        // Relink the placeholder to this Google account (keeps role='owner', so the
        // role-based lookups below and the ownerUserId cache stay valid).
        this._stmts.adoptUser.run(googleSub, email, name, owner.id);
        return owner.id;
      }
    }
    return Number(this._stmts.insertUser.run(googleSub, email, name, role).lastInsertRowid);
  }

  /**
   * Meter one compile against a user's daily quota (UTC day). Atomic
   * check-then-increment: returns {ok:false} WITHOUT counting once the cap is hit,
   * so a blocked request costs nothing. `day` is injectable for tests.
   */
  bumpCompileQuota(userId, limit, day = new Date().toISOString().slice(0, 10)) {
    return this.db.transaction(() => {
      const used = this._stmts.getCompileCount.get(userId, day)?.count ?? 0;
      if (used >= limit) return { ok: false, used, limit };
      this._stmts.bumpCompileCount.run(userId, day);
      return { ok: true, used: used + 1, limit };
    })();
  }

  /**
   * Fold a stray account (created before OWNER_EMAIL was set) into the '@owner'
   * placeholder: move any résumés it made over to the owner, carry its style settings
   * across, delete it (which frees the UNIQUE google_sub), then relink '@owner' to the
   * real Google identity. Atomic. Returns the owner id, or null when there's no
   * unclaimed placeholder to adopt into (caller then falls back to a profile update).
   *
   * The settings copy runs before the delete: settings cascade with their account, and
   * without it the adopted résumés would restyle. The owner's own keys win.
   */
  _adoptStrayIntoOwner(stray, { googleSub, email, name }) {
    const ownerId = this.ownerUserId();
    const owner = ownerId != null ? this.getUser(ownerId) : null;
    if (!owner || owner.google_sub !== '@owner' || owner.id === stray.id) return null;
    this.db.transaction(() => {
      this._stmts.reassignProfiles.run(owner.id, stray.id); // keep anything they created
      this._stmts.copySettingsToUser.run(owner.id, stray.id);
      this._stmts.deleteUser.run(stray.id); // frees the UNIQUE google_sub for the relink
      this._stmts.adoptUser.run(googleSub, email, name, owner.id);
    })();
    return owner.id;
  }
  // The owner/system accounts are resolved by role rather than by their placeholder
  // placeholder sub — owner adoption rewrites the owner's sub to a real Google id, but
  // the role never changes, so these (and their caches) survive it.
  /** The account that owns the public demo — resolved once, then cached. */
  systemUserId() {
    return (this._systemUserId ??= this._stmts.userIdByRole.get('system')?.id ?? null);
  }
  /** The owner account (everything pre-multi-tenancy, then you) — cached. */
  ownerUserId() {
    return (this._ownerUserId ??= this._stmts.userIdByRole.get('owner')?.id ?? null);
  }
  /** The owner of a profile, or null. Cheap ownership probe for gating. */
  profileUserId(id) {
    return this._stmts.profileUserId.get(id)?.user_id ?? null;
  }

  getProfiles() {
    // Unscoped — SYSTEM use only (build verification, admin). Request handlers must
    // go through getProfilesForUser so a leak can't slip in unnoticed.
    return this._stmts.getProfiles.all();
  }
  getProfilesForUser(userId) {
    return this._stmts.getProfilesForUser.all(userId);
  }

  getProfile(id) {
    return this._stmts.getProfile.get(id) || null;
  }
  getProfileForUser(id, userId) {
    return this._stmts.getProfileForUser.get(id, userId) || null;
  }

  createProfile(name, userId = this.ownerUserId()) {
    return this._stmts.insertProfile.run(name, userId).lastInsertRowid;
  }

  renameProfile(id, name) {
    this._stmts.updateProfileName.run(name, id);
  }
  /** Rename only if `userId` owns the profile. Returns true if a row changed. */
  renameProfileForUser(id, name, userId) {
    return this._stmts.renameProfileForUser.run(name, id, userId).changes > 0;
  }

  deleteProfile(id) {
    // Cascades to profile_settings, sections→entries→items→tags, variants→rules/overrides/sections/letters.
    this._stmts.deleteProfile.run(id);
  }
  /** Delete only if `userId` owns the profile. Returns true if a row was removed. */
  deleteProfileForUser(id, userId) {
    return this._stmts.deleteProfileForUser.run(id, userId).changes > 0;
  }

  /** Full main content for a profile, but only if `userId` owns it (else null). */
  getMainForUser(profileId, userId) {
    if (this.profileUserId(profileId) !== userId) return null;
    return this.getMain(profileId);
  }

  // Sections

  getSections(profileId) {
    return this._stmts.getSectionsByProfile.all(profileId).map(rowToSection);
  }

  /** Section with full entries→items→tags. */
  getSection(id) {
    const s = this._stmts.getSection.get(id);
    if (!s) return null;
    return { ...rowToSection(s), entries: this._entriesForSection(id) };
  }

  _entriesForSection(sectionId) {
    return this._stmts.getEntries.all(sectionId).map((e) => ({
      id: e.id,
      sectionId: e.section_id,
      sortOrder: e.sort_order,
      fields: JSON.parse(e.fields),
      tags: this._stmts.getEntryTags.all(e.id).map((r) => r.tag),
      items: this._stmts.getItems.all(e.id).map((i) => ({
        id: i.id,
        entryId: i.entry_id,
        sortOrder: i.sort_order,
        content: i.content,
        title: i.title,
        tags: this._stmts.getItemTags.all(i.id).map((r) => r.tag),
      })),
    }));
  }

  createSection(profileId, slug, type, title = '') {
    const order = this._stmts.maxSectionSortOrder.get(profileId).m + 1;
    return this._stmts.insertSection.run(profileId, slug, normalizeType(type), title, order)
      .lastInsertRowid;
  }

  updateSection(id, { slug, type, title }) {
    const cur = this._stmts.getSection.get(id);
    if (!cur) return;
    if (slug !== undefined || type !== undefined) {
      this._stmts.updateSectionSlugType.run(
        slug ?? cur.slug,
        type !== undefined ? normalizeType(type) : cur.type,
        title ?? cur.title,
        id,
      );
    } else if (title !== undefined) {
      this._stmts.updateSectionTitle.run(title, id);
    }
  }

  deleteSection(id) {
    this._stmts.deleteSection.run(id);
  }

  reorderSections(profileId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateSectionSortOrder.run(i, ids[i]);
    });
    tx();
  }

  // Entries

  getEntry(id) {
    const e = this._stmts.getEntry.get(id);
    if (!e) return null;
    return {
      id: e.id,
      sectionId: e.section_id,
      sortOrder: e.sort_order,
      fields: JSON.parse(e.fields),
      tags: this._stmts.getEntryTags.all(e.id).map((r) => r.tag),
      items: this._stmts.getItems.all(e.id).map((i) => ({
        id: i.id,
        entryId: i.entry_id,
        sortOrder: i.sort_order,
        content: i.content,
        title: i.title,
        tags: this._stmts.getItemTags.all(i.id).map((r) => r.tag),
      })),
    };
  }

  createEntry(sectionId, fields) {
    const order = this._stmts.maxEntrySortOrder.get(sectionId).m + 1;
    return this._stmts.insertEntry.run(sectionId, order, JSON.stringify(fields || {}))
      .lastInsertRowid;
  }

  updateEntry(id, { fields }) {
    if (fields !== undefined) this._stmts.updateEntryFields.run(JSON.stringify(fields), id);
  }

  deleteEntry(id) {
    this._stmts.deleteEntry.run(id);
  }

  reorderEntries(sectionId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++)
        this._stmts.updateEntrySortOrder.run(i, ids[i], sectionId);
    });
    tx();
  }

  // Items

  createItem(entryId, content, title = '') {
    const order = this._stmts.maxItemSortOrder.get(entryId).m + 1;
    return this._stmts.insertItem.run(entryId, order, content, title).lastInsertRowid;
  }

  updateItem(id, { content, title }) {
    const tx = this.db.transaction(() => {
      if (content !== undefined) this._stmts.updateItemContent.run(content, id);
      if (title !== undefined) this._stmts.updateItemTitle.run(title, id);
    });
    tx();
  }

  deleteItem(id) {
    this._stmts.deleteItem.run(id);
  }

  reorderItems(entryId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateItemSortOrder.run(i, ids[i], entryId);
    });
    tx();
  }

  // Tag subsystem (tags / aliases / catalog / suggestion) is a mixin.

  // Variant subsystem (CRUD / rules / sections / overrides / letters / resolution)
  // is a mixin.

  // Aggregate read for MCP / UI — full main + variant summaries

  getMain(profileId) {
    const profile = this.getProfile(profileId);
    if (!profile) return null;
    return {
      profile,
      personal: this.getPersonal(profileId),
      sections: this.getSections(profileId).map((s) => this.getSection(s.id)),
      variants: this.getVariants(profileId).map((v) => ({
        ...v,
        rules: this.getVariantRules(v.id),
        sections: this.getVariantSections(v.id),
        // Manual overrides so the editor's client lens can display them live
        // (keyed by entry/item id, same shape as GET /variants/:id).
        entryOverrides: Object.fromEntries(this.getEntryOverrides(v.id)),
        itemOverrides: Object.fromEntries(this.getItemOverrides(v.id)),
        personal: this.getVariantPersonal(v.id),
        settings: this.getVariantSettings(v.id),
      })),
      tags: this.listTags(profileId),
      tagAliases: this.getTagAliases(profileId),
      tagCatalog: this.getTagCatalog(profileId),
    };
  }

  /**
   * The profile that owns an id-addressed resource, or null if it doesn't exist.
   * `kind` ∈ variant | section | entry | item. Used by the auth gate to decide
   * whether a read exposes a non-public profile's data.
   */
  ownerProfileId(kind, id) {
    const stmt = {
      variant: this._stmts.ownerOfVariant,
      section: this._stmts.ownerOfSection,
      entry: this._stmts.ownerOfEntry,
      item: this._stmts.ownerOfItem,
    }[kind];
    if (!stmt) return null;
    const row = stmt.get(id);
    return row ? row.pid : null;
  }

  // Export / import / seeding is a mixin.

  // Lifecycle

  close() {
    this.db.close();
  }
}

// Method mixins

// Each method cluster is its own module, mixed onto the prototype so the public
// surface (and getDb()) stays a single CvDatabase class.
Object.assign(CvDatabase.prototype, require('./db/settings'));
applyMixin(CvDatabase, require('./db/tags'));
applyMixin(CvDatabase, require('./db/variants'));
applyMixin(CvDatabase, require('./db/layouts'));
applyMixin(CvDatabase, require('./db/import-export'));
applyMixin(CvDatabase, require('./db/versions'));
applyMixin(CvDatabase, require('./db/linkedin'));

module.exports = CvDatabase;
