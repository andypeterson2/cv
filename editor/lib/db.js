/**
 * SQLite access layer for the CV Editor (normalized, stateless model).
 *
 * Single source of truth — every person owns a master CV (sections → entries →
 * items, with free-string tags) plus named variants. A variant is a lightweight
 * overlay: a tag query (variant_rules) + sparse per-entry/item exceptions
 * (entry_overrides / item_overrides) + a section list (variant_sections), or —
 * for coverletter-kind variants — a list of letter paragraphs.
 *
 * There is NO "active person" and NO JSON-blob working copy. All ids are stable
 * and every method takes the ids it operates on, so callers (REST, MCP) are
 * fully addressable and stateless.
 *
 * Style/spacing/fonts remain GLOBAL (the `settings` table); personal info and
 * the cover-letter header are per-person (`person_settings`).
 */

const Database = require('better-sqlite3');
const runMigrations = require('./migration-runner');
const { JANE_DOE_DATA } = require('./seed-data');
const { getLatexType, normalizeType } = require('./latex-type-map');
const fuzzy = require('./fuzzy');
const suggest = require('./suggest');

const KINDS = ['cv', 'resume', 'coverletter'];

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

  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  _prepareStatements() {
    const p = (sql) => this.db.prepare(sql);
    this._stmts = {
      // Global settings (style/spacing/fonts)
      getSettings: p("SELECT key, value, value_num, value_unit FROM settings WHERE key LIKE ? || '%'"),
      upsertSetting: p('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      upsertSettingUnit: p('INSERT INTO settings (key, value, value_num, value_unit) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_num = excluded.value_num, value_unit = excluded.value_unit'),

      // Person settings (personal.* / coverletter.*)
      getPersonSettings: p("SELECT key, value, value_num, value_unit FROM person_settings WHERE person_id = ? AND key LIKE ? || '%'"),
      upsertPersonSetting: p('INSERT INTO person_settings (person_id, key, value) VALUES (?, ?, ?) ON CONFLICT(person_id, key) DO UPDATE SET value = excluded.value'),
      deletePersonSetting: p('DELETE FROM person_settings WHERE person_id = ? AND key = ?'),

      // Persons
      getPersons: p('SELECT id, name, created_at FROM persons ORDER BY id'),
      getPerson: p('SELECT id, name, created_at FROM persons WHERE id = ?'),
      insertPerson: p('INSERT INTO persons (name) VALUES (?)'),
      updatePersonName: p('UPDATE persons SET name = ? WHERE id = ?'),
      deletePerson: p('DELETE FROM persons WHERE id = ?'),
      countPersons: p('SELECT COUNT(*) AS cnt FROM persons'),

      // Sections
      getSectionsByPerson: p('SELECT id, person_id, slug, type, title, sort_order FROM sections WHERE person_id = ? ORDER BY sort_order, id'),
      getSection: p('SELECT id, person_id, slug, type, title, sort_order FROM sections WHERE id = ?'),
      insertSection: p('INSERT INTO sections (person_id, slug, type, title, sort_order) VALUES (?, ?, ?, ?, ?)'),
      updateSectionTitle: p('UPDATE sections SET title = ? WHERE id = ?'),
      updateSectionSlugType: p('UPDATE sections SET slug = ?, type = ?, title = ? WHERE id = ?'),
      updateSectionSortOrder: p('UPDATE sections SET sort_order = ? WHERE id = ?'),
      deleteSection: p('DELETE FROM sections WHERE id = ?'),
      maxSectionSortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sections WHERE person_id = ?'),

      // Entries
      getEntries: p('SELECT id, section_id, sort_order, fields FROM entries WHERE section_id = ? ORDER BY sort_order, id'),
      getEntry: p('SELECT id, section_id, sort_order, fields FROM entries WHERE id = ?'),
      insertEntry: p('INSERT INTO entries (section_id, sort_order, fields) VALUES (?, ?, ?)'),
      updateEntryFields: p('UPDATE entries SET fields = ? WHERE id = ?'),
      updateEntrySortOrder: p('UPDATE entries SET sort_order = ? WHERE id = ?'),
      deleteEntry: p('DELETE FROM entries WHERE id = ?'),
      maxEntrySortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM entries WHERE section_id = ?'),

      // Items
      getItems: p('SELECT id, entry_id, sort_order, content, title FROM items WHERE entry_id = ? ORDER BY sort_order, id'),
      getItem: p('SELECT id, entry_id, sort_order, content, title FROM items WHERE id = ?'),
      insertItem: p('INSERT INTO items (entry_id, sort_order, content, title) VALUES (?, ?, ?, ?)'),
      updateItemContent: p('UPDATE items SET content = ? WHERE id = ?'),
      updateItemTitle: p('UPDATE items SET title = ? WHERE id = ?'),
      updateItemSortOrder: p('UPDATE items SET sort_order = ? WHERE id = ?'),
      deleteItem: p('DELETE FROM items WHERE id = ?'),
      maxItemSortOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM items WHERE entry_id = ?'),

      // Tags
      getEntryTags: p('SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag'),
      addEntryTag: p('INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?, ?)'),
      delEntryTag: p('DELETE FROM entry_tags WHERE entry_id = ? AND tag = ?'),
      getItemTags: p('SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag'),
      addItemTag: p('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)'),
      delItemTag: p('DELETE FROM item_tags WHERE item_id = ? AND tag = ?'),
      listEntryTags: p('SELECT DISTINCT et.tag FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?'),
      listItemTags: p('SELECT DISTINCT it.tag FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?'),
      countEntryTags: p('SELECT et.tag AS tag, COUNT(*) AS cnt FROM entry_tags et JOIN entries e ON et.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ? GROUP BY et.tag'),
      countItemTags: p('SELECT it.tag AS tag, COUNT(*) AS cnt FROM item_tags it JOIN items i ON it.item_id = i.id JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ? GROUP BY it.tag'),
      personForEntry: p('SELECT s.person_id AS pid FROM entries e JOIN sections s ON e.section_id = s.id WHERE e.id = ?'),
      personForItem: p('SELECT s.person_id AS pid FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE i.id = ?'),

      // Tag aliases (per-person alias → canonical)
      getAliases: p('SELECT alias, canonical, source FROM tag_aliases WHERE person_id = ? ORDER BY alias'),
      getAlias: p('SELECT canonical FROM tag_aliases WHERE person_id = ? AND alias = ?'),
      upsertAlias: p('INSERT INTO tag_aliases (person_id, alias, canonical, source) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, alias) DO UPDATE SET canonical = excluded.canonical, source = excluded.source'),
      delAlias: p('DELETE FROM tag_aliases WHERE person_id = ? AND alias = ?'),
      // Retroactive alias application: fold an existing tag into its canonical,
      // person-scoped. UPDATE OR IGNORE moves rows that don't collide; the
      // paired DELETE clears any that did (the canonical already existed).
      rewriteEntryTag: p('UPDATE OR IGNORE entry_tags SET tag = ? WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      delEntryTagP: p('DELETE FROM entry_tags WHERE tag = ? AND entry_id IN (SELECT e.id FROM entries e JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      rewriteItemTag: p('UPDATE OR IGNORE item_tags SET tag = ? WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      delItemTagP: p('DELETE FROM item_tags WHERE tag = ? AND item_id IN (SELECT i.id FROM items i JOIN entries e ON i.entry_id = e.id JOIN sections s ON e.section_id = s.id WHERE s.person_id = ?)'),
      rewriteRuleTag: p('UPDATE OR IGNORE variant_rules SET tag = ? WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE person_id = ?)'),
      delRuleTagP: p('DELETE FROM variant_rules WHERE tag = ? AND variant_id IN (SELECT id FROM variants WHERE person_id = ?)'),

      // Tag catalog (per-person controlled vocabulary)
      getCatalog: p('SELECT tag, description, category FROM tag_catalog WHERE person_id = ? ORDER BY tag'),
      upsertCatalogTag: p('INSERT INTO tag_catalog (person_id, tag, description, category) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, tag) DO UPDATE SET description = excluded.description, category = excluded.category'),
      delCatalogTag: p('DELETE FROM tag_catalog WHERE person_id = ? AND tag = ?'),

      // Variants
      getVariants: p('SELECT id, person_id, name, kind, created_at FROM variants WHERE person_id = ? ORDER BY id'),
      getVariant: p('SELECT id, person_id, name, kind, created_at FROM variants WHERE id = ?'),
      insertVariant: p('INSERT INTO variants (person_id, name, kind) VALUES (?, ?, ?)'),
      updateVariantName: p('UPDATE variants SET name = ? WHERE id = ?'),
      deleteVariant: p('DELETE FROM variants WHERE id = ?'),

      // Variant rules
      getVariantRules: p('SELECT tag, mode FROM variant_rules WHERE variant_id = ?'),
      clearVariantRules: p('DELETE FROM variant_rules WHERE variant_id = ?'),
      insertVariantRule: p('INSERT OR IGNORE INTO variant_rules (variant_id, tag, mode) VALUES (?, ?, ?)'),

      // Variant sections
      getVariantSections: p('SELECT section_id, enabled, sort_order FROM variant_sections WHERE variant_id = ? ORDER BY sort_order, section_id'),
      clearVariantSections: p('DELETE FROM variant_sections WHERE variant_id = ?'),
      insertVariantSection: p('INSERT OR IGNORE INTO variant_sections (variant_id, section_id, enabled, sort_order) VALUES (?, ?, ?, ?)'),

      // Overrides
      getEntryOverrides: p('SELECT entry_id, included, text_override, sort_override FROM entry_overrides WHERE variant_id = ?'),
      upsertEntryOverride: p('INSERT INTO entry_overrides (variant_id, entry_id, included, text_override, sort_override) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, entry_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override'),
      deleteEntryOverride: p('DELETE FROM entry_overrides WHERE variant_id = ? AND entry_id = ?'),
      getItemOverrides: p('SELECT item_id, included, text_override, sort_override FROM item_overrides WHERE variant_id = ?'),
      upsertItemOverride: p('INSERT INTO item_overrides (variant_id, item_id, included, text_override, sort_override) VALUES (?, ?, ?, ?, ?) ON CONFLICT(variant_id, item_id) DO UPDATE SET included = excluded.included, text_override = excluded.text_override, sort_override = excluded.sort_override'),
      deleteItemOverride: p('DELETE FROM item_overrides WHERE variant_id = ? AND item_id = ?'),

      // Variant letter sections
      getLetterSections: p('SELECT id, sort_order, title, body FROM variant_letter_sections WHERE variant_id = ? ORDER BY sort_order, id'),
      insertLetterSection: p('INSERT INTO variant_letter_sections (variant_id, sort_order, title, body) VALUES (?, ?, ?, ?)'),
      updateLetterSection: p('UPDATE variant_letter_sections SET title = ?, body = ? WHERE id = ?'),
      deleteLetterSection: p('DELETE FROM variant_letter_sections WHERE id = ?'),
      updateLetterSectionOrder: p('UPDATE variant_letter_sections SET sort_order = ? WHERE id = ?'),
      maxLetterSectionOrder: p('SELECT COALESCE(MAX(sort_order), -1) AS m FROM variant_letter_sections WHERE variant_id = ?'),
    };
  }

  // ---------------------------------------------------------------------------
  // Global settings (style / spacing / fonts)
  // ---------------------------------------------------------------------------

  getSettings(prefix) {
    const rows = this._stmts.getSettings.all(prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  }

  setSettings(map) {
    const tx = this.db.transaction((entries) => {
      for (const [key, val] of entries) {
        if (val && typeof val === 'object' && 'num' in val && 'unit' in val) {
          this._stmts.upsertSettingUnit.run(key, String(val.num) + val.unit, val.num, val.unit);
        } else {
          this._stmts.upsertSetting.run(key, val);
        }
      }
    });
    tx(Object.entries(map));
  }

  // ---------------------------------------------------------------------------
  // Person settings (personal.* / coverletter.*)
  // ---------------------------------------------------------------------------

  getPersonSettings(personId, prefix) {
    const rows = this._stmts.getPersonSettings.all(personId, prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  }

  setPersonSettings(personId, map) {
    const tx = this.db.transaction(() => {
      for (const [key, val] of Object.entries(map)) {
        this._stmts.upsertPersonSetting.run(personId, key, val == null ? null : String(val));
      }
    });
    tx();
  }

  /** personal.* settings → flat object with the prefix stripped. */
  getPersonal(personId) {
    return stripPrefix(this.getPersonSettings(personId, 'personal'), 'personal.');
  }

  setPersonal(personId, fields) {
    const map = {};
    for (const [k, v] of Object.entries(fields)) map['personal.' + k] = v;
    this.setPersonSettings(personId, map);
  }

  /** coverletter.* header settings → flat object (no `sections`). */
  getCoverletterHeader(personId) {
    return stripPrefix(this.getPersonSettings(personId, 'coverletter'), 'coverletter.');
  }

  // ---------------------------------------------------------------------------
  // Persons
  // ---------------------------------------------------------------------------

  getPersons() {
    return this._stmts.getPersons.all();
  }

  getPerson(id) {
    return this._stmts.getPerson.get(id) || null;
  }

  createPerson(name) {
    return this._stmts.insertPerson.run(name).lastInsertRowid;
  }

  renamePerson(id, name) {
    this._stmts.updatePersonName.run(name, id);
  }

  deletePerson(id) {
    // Cascades to person_settings, sections→entries→items→tags, variants→rules/overrides/sections/letters.
    this._stmts.deletePerson.run(id);
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  getSections(personId) {
    return this._stmts.getSectionsByPerson.all(personId).map(rowToSection);
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

  createSection(personId, slug, type, title = '') {
    const order = this._stmts.maxSectionSortOrder.get(personId).m + 1;
    return this._stmts.insertSection.run(personId, slug, normalizeType(type), title, order).lastInsertRowid;
  }

  updateSection(id, { slug, type, title }) {
    const cur = this._stmts.getSection.get(id);
    if (!cur) return;
    if (slug !== undefined || type !== undefined) {
      this._stmts.updateSectionSlugType.run(
        slug ?? cur.slug,
        type !== undefined ? normalizeType(type) : cur.type,
        title ?? cur.title,
        id
      );
    } else if (title !== undefined) {
      this._stmts.updateSectionTitle.run(title, id);
    }
  }

  deleteSection(id) {
    this._stmts.deleteSection.run(id);
  }

  reorderSections(personId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateSectionSortOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

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
        id: i.id, entryId: i.entry_id, sortOrder: i.sort_order, content: i.content, title: i.title,
        tags: this._stmts.getItemTags.all(i.id).map((r) => r.tag),
      })),
    };
  }

  createEntry(sectionId, fields) {
    const order = this._stmts.maxEntrySortOrder.get(sectionId).m + 1;
    return this._stmts.insertEntry.run(sectionId, order, JSON.stringify(fields || {})).lastInsertRowid;
  }

  updateEntry(id, { fields }) {
    if (fields !== undefined) this._stmts.updateEntryFields.run(JSON.stringify(fields), id);
  }

  deleteEntry(id) {
    this._stmts.deleteEntry.run(id);
  }

  reorderEntries(sectionId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateEntrySortOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

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
      for (let i = 0; i < ids.length; i++) this._stmts.updateItemSortOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  addEntryTags(entryId, tags) {
    const pid = this._stmts.personForEntry.get(entryId)?.pid;
    const tx = this.db.transaction(() => {
      for (const t of tags) {
        const tag = this._canonicalTag(pid, t);
        if (tag) this._stmts.addEntryTag.run(entryId, tag);
      }
    });
    tx();
  }

  removeEntryTag(entryId, tag) {
    const pid = this._stmts.personForEntry.get(entryId)?.pid;
    this._stmts.delEntryTag.run(entryId, this._canonicalTag(pid, tag));
  }

  addItemTags(itemId, tags) {
    const pid = this._stmts.personForItem.get(itemId)?.pid;
    const tx = this.db.transaction(() => {
      for (const t of tags) {
        const tag = this._canonicalTag(pid, t);
        if (tag) this._stmts.addItemTag.run(itemId, tag);
      }
    });
    tx();
  }

  removeItemTag(itemId, tag) {
    const pid = this._stmts.personForItem.get(itemId)?.pid;
    this._stmts.delItemTag.run(itemId, this._canonicalTag(pid, tag));
  }

  /** Distinct tag vocabulary across a person's entries + items. */
  listTags(personId) {
    const set = new Set();
    for (const r of this._stmts.listEntryTags.all(personId)) set.add(r.tag);
    for (const r of this._stmts.listItemTags.all(personId)) set.add(r.tag);
    return [...set].sort();
  }

  /** Tag vocabulary with usage counts (entries + items): [{tag, count}], desc. */
  listTagsWithCounts(personId) {
    const counts = new Map();
    for (const r of this._stmts.countEntryTags.all(personId)) counts.set(r.tag, (counts.get(r.tag) || 0) + r.cnt);
    for (const r of this._stmts.countItemTags.all(personId)) counts.set(r.tag, (counts.get(r.tag) || 0) + r.cnt);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  }

  /**
   * Fuzzy-rank a person's tag vocabulary against a query string. Approximate —
   * for discovery and authoring only; never used by variant resolution. If the
   * query is itself an alias, its canonical is surfaced as an exact hit.
   * @returns {query, results:[{tag, score, count, via}]}
   */
  searchTags(personId, query, { limit = 10, minScore = 0.3 } = {}) {
    const q = normTag(query);
    const vocab = this.listTagsWithCounts(personId);
    let results = fuzzy.searchTags(q, vocab, { limit, minScore });

    // If `q` is an alias, its canonical is an exact intent match — surface it
    // first as via:'alias' (score 1), replacing any coincidental string match
    // for the same tag (e.g. q="kube" also prefixes "kubernetes").
    const canonical = this._resolveAlias(personId, q);
    if (canonical !== q) {
      const hit = vocab.find((v) => v.tag === canonical);
      results = [
        { tag: canonical, score: 1, count: hit ? hit.count : 0, via: 'alias' },
        ...results.filter((r) => r.tag !== canonical),
      ];
      if (limit > 0 && results.length > limit) results = results.slice(0, limit);
    }
    return { query: q, results };
  }

  // ---------------------------------------------------------------------------
  // Tag aliases (per-person alias → canonical)
  // ---------------------------------------------------------------------------

  getTagAliases(personId) {
    return this._stmts.getAliases.all(personId);
  }

  /** Follow the alias chain to its terminal canonical (cycle-safe). */
  _resolveAlias(personId, tag, _seen) {
    let cur = tag;
    const seen = _seen || new Set([cur]);
    for (let i = 0; i < 16; i++) {
      const row = this._stmts.getAlias.get(personId, cur);
      if (!row || !row.canonical) return cur;
      if (seen.has(row.canonical)) return cur; // defensive — writes reject cycles
      seen.add(row.canonical);
      cur = row.canonical;
    }
    return cur;
  }

  /** Normalize a tag, then fold it through the alias map to its canonical. */
  _canonicalTag(personId, tag) {
    const t = normTag(tag);
    if (!t || personId == null) return t;
    return this._resolveAlias(personId, t);
  }

  /**
   * Define alias → canonical for a person and fold any existing `alias`-tagged
   * content/rules into `canonical` so the vocabulary converges. Both sides are
   * normalized first.
   * @throws AppError-like Error with .status on self-alias or cycle.
   */
  setTagAlias(personId, alias, canonical, source = 'manual') {
    const a = normTag(alias);
    const c = normTag(canonical);
    if (!a || !c) { const e = new Error('alias and canonical must be non-empty after normalization'); e.status = 400; throw e; }
    if (a === c) { const e = new Error('alias and canonical cannot be the same tag'); e.status = 409; throw e; }
    // Reject cycles: canonical must not resolve back to alias.
    if (this._resolveAlias(personId, c) === a) { const e = new Error(`alias "${a}" → "${c}" would create a cycle`); e.status = 409; throw e; }

    const tx = this.db.transaction(() => {
      this._stmts.upsertAlias.run(personId, a, c, source);
      // Retroactively fold existing usage of `a` into `c`.
      this._stmts.rewriteEntryTag.run(c, a, personId);
      this._stmts.delEntryTagP.run(a, personId);
      this._stmts.rewriteItemTag.run(c, a, personId);
      this._stmts.delItemTagP.run(a, personId);
      this._stmts.rewriteRuleTag.run(c, a, personId);
      this._stmts.delRuleTagP.run(a, personId);
    });
    tx();
    return { alias: a, canonical: c };
  }

  deleteTagAlias(personId, alias) {
    this._stmts.delAlias.run(personId, normTag(alias));
  }

  // ---------------------------------------------------------------------------
  // Tag catalog (per-person controlled vocabulary) + suggestion
  // ---------------------------------------------------------------------------

  getTagCatalog(personId) {
    return this._stmts.getCatalog.all(personId);
  }

  /**
   * Upsert a catalog entry. The tag is normalized + alias-folded via
   * _canonicalTag, so a catalog entry can never disagree with a stored tag's
   * canonical form.
   */
  setCatalogTag(personId, tag, { description = null, category = null } = {}) {
    const t = this._canonicalTag(personId, tag);
    if (!t) { const e = new Error('tag must be non-empty after normalization'); e.status = 400; throw e; }
    this._stmts.upsertCatalogTag.run(personId, t, description, category);
    return { tag: t };
  }

  deleteCatalogTag(personId, tag) {
    this._stmts.delCatalogTag.run(personId, this._canonicalTag(personId, tag));
  }

  /** Opt-in bootstrap: promote the current usage vocabulary into the catalog. Returns {added}. */
  seedCatalogFromUsage(personId) {
    const existing = new Set(this._stmts.getCatalog.all(personId).map((r) => r.tag));
    let added = 0;
    const tx = this.db.transaction(() => {
      for (const { tag } of this.listTagsWithCounts(personId)) {
        if (existing.has(tag)) continue;
        this._stmts.upsertCatalogTag.run(personId, tag, null, null);
        added++;
      }
    });
    tx();
    return { added };
  }

  /**
   * Suggest existing tags for a piece of text. Ranks the union of the catalog
   * (preferred) and the usage vocabulary; NEVER invents a tag. Approximate —
   * discovery/authoring only (lib/suggest.js). `scorer` (optional) swaps in an
   * alternate ranker (e.g. embeddings) without changing this method's shape.
   * @returns {Promise<{query, results:[{tag, score, inCatalog, count, via}]}>}
   */
  /** Candidate vocab for suggestion: catalog (preferred) ∪ usage vocab, deduped by tag. */
  _suggestCandidates(personId) {
    const byTag = new Map();
    for (const c of this._stmts.getCatalog.all(personId)) {
      byTag.set(c.tag, { tag: c.tag, count: 0, inCatalog: true, description: c.description || undefined });
    }
    for (const { tag, count } of this.listTagsWithCounts(personId)) {
      const cur = byTag.get(tag);
      if (cur) cur.count = count;
      else byTag.set(tag, { tag, count, inCatalog: false });
    }
    return [...byTag.values()];
  }

  async suggestTags(personId, text, { limit = 8, minScore = 0.35, scorer } = {}) {
    const results = await suggest.suggestTags(text, this._suggestCandidates(personId), { limit, minScore, scorer });
    return { query: String(text), results };
  }

  /**
   * Suggest tags for EVERY entry/item of a person in one pass — the natural
   * step right after a legacy import that arrived untagged. Suggest-ONLY: writes
   * nothing; returns candidates + the target's current tags so a confirmer
   * (Claude/UI) can apply via addEntryTags/addItemTags. Candidate vocab is built
   * once and reused across items.
   */
  async suggestBulk(personId, { limit = 5, minScore = 0.4, scorer } = {}) {
    const candidates = this._suggestCandidates(personId);
    const out = [];
    for (const s of this.getSections(personId)) {
      const full = this.getSection(s.id);
      for (const e of full.entries) {
        const eText = entryText(e.fields);
        if (eText) {
          out.push({ target: 'entry', id: e.id, text: eText, current: e.tags, suggestions: await suggest.suggestTags(eText, candidates, { limit, minScore, scorer }) });
        }
        for (const it of e.items) {
          const iText = (it.content || '').trim();
          if (iText) {
            out.push({ target: 'item', id: it.id, text: iText, current: it.tags, suggestions: await suggest.suggestTags(iText, candidates, { limit, minScore, scorer }) });
          }
        }
      }
    }
    return { count: out.length, items: out };
  }

  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------

  getVariants(personId) {
    return this._stmts.getVariants.all(personId).map(rowToVariant);
  }

  getVariant(id) {
    const v = this._stmts.getVariant.get(id);
    return v ? rowToVariant(v) : null;
  }

  createVariant(personId, name, kind) {
    if (!KINDS.includes(kind)) throw new Error(`Invalid variant kind: ${kind}`);
    return this._stmts.insertVariant.run(personId, name, kind).lastInsertRowid;
  }

  updateVariant(id, { name }) {
    if (name !== undefined) this._stmts.updateVariantName.run(name, id);
  }

  deleteVariant(id) {
    this._stmts.deleteVariant.run(id);
  }

  // ---- rules ----

  getVariantRules(variantId) {
    const include = [];
    const exclude = [];
    for (const r of this._stmts.getVariantRules.all(variantId)) {
      (r.mode === 'exclude' ? exclude : include).push(r.tag);
    }
    return { include, exclude };
  }

  /** Replace a variant's tag rules. Include wins if a tag appears in both. */
  setVariantRules(variantId, { include = [], exclude = [] } = {}) {
    const pid = this._stmts.getVariant.get(variantId)?.person_id;
    const canon = (t) => this._canonicalTag(pid, t);
    const tx = this.db.transaction(() => {
      this._stmts.clearVariantRules.run(variantId);
      for (const t of include) { const tag = canon(t); if (tag) this._stmts.insertVariantRule.run(variantId, tag, 'include'); }
      for (const t of exclude) { const tag = canon(t); if (tag) this._stmts.insertVariantRule.run(variantId, tag, 'exclude'); }
    });
    tx();
  }

  /**
   * Author-time fuzzy expansion of a variant's include rules. For each current
   * include tag, fuzzy-match the person's vocabulary and ADD every tag scoring
   * >= threshold to the include set, writing the concrete expanded list back.
   *
   * This is the ONLY bridge between fuzzy matching and what a variant renders —
   * and it is deliberate: the fuzz happens once, here, and is frozen into stored
   * rules you can read back. Resolution itself never sees a fuzzy match, so the
   * rendered PDF stays exact and reproducible.
   * @returns {before, after, added:[{tag, from, score, via}]}
   */
  expandVariantRules(variantId, { threshold = 0.6, limit = 25 } = {}) {
    const pid = this._stmts.getVariant.get(variantId)?.person_id;
    const rules = this.getVariantRules(variantId);
    const before = [...rules.include];
    const have = new Set(before);
    const vocab = this.listTagsWithCounts(pid);
    const added = [];

    for (const seed of before) {
      for (const r of fuzzy.searchTags(seed, vocab, { limit, minScore: threshold })) {
        if (have.has(r.tag)) continue;
        have.add(r.tag);
        added.push({ tag: r.tag, from: seed, score: r.score, via: r.via });
      }
    }

    if (added.length) {
      this.setVariantRules(variantId, { include: [...have], exclude: rules.exclude });
    }
    return { before, after: [...have], added };
  }

  // ---- sections ----

  getVariantSections(variantId) {
    return this._stmts.getVariantSections.all(variantId).map((r) => ({
      sectionId: r.section_id,
      enabled: !!r.enabled,
      sortOrder: r.sort_order,
    }));
  }

  setVariantSections(variantId, sections) {
    const tx = this.db.transaction(() => {
      this._stmts.clearVariantSections.run(variantId);
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        this._stmts.insertVariantSection.run(
          variantId,
          s.sectionId,
          s.enabled === false ? 0 : 1,
          typeof s.sortOrder === 'number' ? s.sortOrder : i
        );
      }
    });
    tx();
  }

  // ---- overrides ----

  getEntryOverrides(variantId) {
    const m = new Map();
    for (const r of this._stmts.getEntryOverrides.all(variantId)) {
      m.set(r.entry_id, { included: r.included, textOverride: r.text_override, sortOverride: r.sort_override });
    }
    return m;
  }

  getItemOverrides(variantId) {
    const m = new Map();
    for (const r of this._stmts.getItemOverrides.all(variantId)) {
      m.set(r.item_id, { included: r.included, textOverride: r.text_override, sortOverride: r.sort_override });
    }
    return m;
  }

  /** Upsert (or, if all fields null/undefined, delete) an entry override. */
  setEntryOverride(variantId, entryId, { included = null, textOverride = null, sortOverride = null } = {}) {
    if (included == null && textOverride == null && sortOverride == null) {
      this._stmts.deleteEntryOverride.run(variantId, entryId);
      return;
    }
    this._stmts.upsertEntryOverride.run(variantId, entryId, included == null ? null : (included ? 1 : 0), textOverride, sortOverride);
  }

  setItemOverride(variantId, itemId, { included = null, textOverride = null, sortOverride = null } = {}) {
    if (included == null && textOverride == null && sortOverride == null) {
      this._stmts.deleteItemOverride.run(variantId, itemId);
      return;
    }
    this._stmts.upsertItemOverride.run(variantId, itemId, included == null ? null : (included ? 1 : 0), textOverride, sortOverride);
  }

  // ---- cover-letter paragraphs ----

  getLetterSections(variantId) {
    return this._stmts.getLetterSections.all(variantId);
  }

  createLetterSection(variantId, title, body) {
    const order = this._stmts.maxLetterSectionOrder.get(variantId).m + 1;
    return this._stmts.insertLetterSection.run(variantId, order, title, body).lastInsertRowid;
  }

  updateLetterSection(id, { title, body }) {
    const cur = this.db.prepare('SELECT title, body FROM variant_letter_sections WHERE id = ?').get(id);
    if (!cur) return;
    this._stmts.updateLetterSection.run(title ?? cur.title, body ?? cur.body, id);
  }

  deleteLetterSection(id) {
    this._stmts.deleteLetterSection.run(id);
  }

  reorderLetterSections(variantId, ids) {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) this._stmts.updateLetterSectionOrder.run(i, ids[i]);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Resolution — variant → compile-ready data for lib/generator
  // ---------------------------------------------------------------------------

  _matchesTags(tags, rules) {
    if (rules.exclude.size && tags.some((t) => rules.exclude.has(t))) return false;
    if (rules.include.size === 0) return true;
    return tags.some((t) => rules.include.has(t));
  }

  _included(tags, rules, override) {
    if (override && override.included != null) return override.included === 1;
    return this._matchesTags(tags, rules);
  }

  _renderSettings() {
    const style = stripPrefix(this.getSettings('style'), 'style.');
    const spacing = combineUnits(stripPrefix(this.getSettings('spacing'), 'spacing.'));
    const fonts = combineUnits(stripPrefix(this.getSettings('fonts'), 'fonts.'));
    return { style, spacing, fonts };
  }

  /**
   * Resolve a variant into the shape lib/generator.generateAll expects:
   *   { personal, sections, coverletter, variant:<kind>, style, spacing, fonts }
   * @throws Error('Variant not found')
   */
  resolveVariant(variantId) {
    return this.db.transaction(() => {
      const v = this._stmts.getVariant.get(variantId);
      if (!v) throw new Error('Variant not found');
      const personId = v.person_id;
      const personal = this.getPersonal(personId);
      const { style, spacing, fonts } = this._renderSettings();

      if (v.kind === 'coverletter') {
        const coverletter = this.getCoverletterHeader(personId);
        coverletter.sections = this.getLetterSections(variantId).map((s) => ({ title: s.title, body: s.body }));
        return { personal, sections: [], coverletter, variant: 'coverletter', style, spacing, fonts };
      }

      const rawRules = this.getVariantRules(variantId);
      const rules = { include: new Set(rawRules.include), exclude: new Set(rawRules.exclude) };
      const entryOv = this.getEntryOverrides(variantId);
      const itemOv = this.getItemOverrides(variantId);

      // Section set + order
      const vsec = this.getVariantSections(variantId);
      let sectionRefs;
      if (vsec.length) {
        sectionRefs = vsec
          .filter((r) => r.enabled)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((r) => r.sectionId);
      } else {
        sectionRefs = this.getSections(personId).map((s) => s.id);
      }

      const sections = [];
      for (const sectionId of sectionRefs) {
        const section = this.getSection(sectionId);
        if (!section) continue;
        const isParagraph = getLatexType(section.type) === 'cvparagraph';

        const entries = [];
        for (const e of section.entries) {
          const eov = entryOv.get(e.id);
          if (!this._included(e.tags, rules, eov)) continue;

          let fields = e.fields;
          if (eov && eov.textOverride != null && isParagraph) {
            fields = { ...fields, text: eov.textOverride };
          }

          const items = [];
          for (const it of e.items) {
            const iov = itemOv.get(it.id);
            if (!this._included(it.tags, rules, iov)) continue;
            const content = iov && iov.textOverride != null ? iov.textOverride : it.content;
            items.push({ ...it, content, _sort: sortKey(iov && iov.sortOverride, it.sortOrder, it.id) });
          }
          items.sort(bySort);

          entries.push({ ...e, fields, items, _sort: sortKey(eov && eov.sortOverride, e.sortOrder, e.id) });
        }
        entries.sort(bySort);
        if (entries.length === 0) continue; // drop empty section

        sections.push({ id: section.slug, type: section.type, title: section.title, entries });
      }

      return { personal, sections, coverletter: null, variant: v.kind, style, spacing, fonts };
    })();
  }

  // ---------------------------------------------------------------------------
  // Aggregate read for MCP / UI — full master + variant summaries
  // ---------------------------------------------------------------------------

  getMaster(personId) {
    const person = this.getPerson(personId);
    if (!person) return null;
    return {
      person,
      personal: this.getPersonal(personId),
      coverletter: this.getCoverletterHeader(personId),
      sections: this.getSections(personId).map((s) => this.getSection(s.id)),
      variants: this.getVariants(personId).map((v) => ({
        ...v,
        rules: this.getVariantRules(v.id),
        sections: this.getVariantSections(v.id),
      })),
      tags: this.listTags(personId),
      tagAliases: this.getTagAliases(personId),
      tagCatalog: this.getTagCatalog(personId),
    };
  }

  // ---------------------------------------------------------------------------
  // Export / import (per person, normalized "new" shape; also accepts legacy)
  // ---------------------------------------------------------------------------

  getPersonExport(personId) {
    const person = this.getPerson(personId);
    if (!person) return null;

    // Overrides reference entry/item ids; export them by POSITION (section
    // slug + indices) so a backup is portable across re-import (where ids change).
    const entryPos = new Map(); // entryId -> { slug, ei }
    const itemPos = new Map(); // itemId -> { slug, ei, ii }

    const sections = this.getSections(personId).map((s) => {
      const full = this.getSection(s.id);
      full.entries.forEach((e, ei) => {
        entryPos.set(e.id, { slug: full.slug, ei });
        e.items.forEach((it, ii) => itemPos.set(it.id, { slug: full.slug, ei, ii }));
      });
      return {
        slug: full.slug,
        type: full.type,
        title: full.title,
        sortOrder: full.sortOrder,
        entries: full.entries.map((e) => ({
          fields: e.fields,
          tags: e.tags,
          items: e.items.map((i) => ({ content: i.content, title: i.title, tags: i.tags })),
        })),
      };
    });

    const variants = this.getVariants(personId).map((v) => {
      const eov = this.getEntryOverrides(v.id);
      const iov = this.getItemOverrides(v.id);
      const entryOverrides = [];
      for (const [eid, o] of eov) {
        const pos = entryPos.get(eid);
        if (pos) entryOverrides.push({ ...pos, included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride });
      }
      const itemOverrides = [];
      for (const [iid, o] of iov) {
        const pos = itemPos.get(iid);
        if (pos) itemOverrides.push({ ...pos, included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride });
      }
      return {
        name: v.name,
        kind: v.kind,
        rules: this.getVariantRules(v.id),
        sections: this.getVariantSections(v.id).map((r) => ({
          slug: this._slugForSection(r.sectionId),
          enabled: r.enabled,
          sortOrder: r.sortOrder,
        })),
        entryOverrides,
        itemOverrides,
        letterSections: v.kind === 'coverletter'
          ? this.getLetterSections(v.id).map((s) => ({ title: s.title, body: s.body }))
          : undefined,
      };
    });

    return {
      name: person.name,
      personal: this.getPersonal(personId),
      coverletter: this.getCoverletterHeader(personId),
      sections,
      variants,
      tagAliases: this.getTagAliases(personId),
      tagCatalog: this.getTagCatalog(personId),
    };
  }

  _slugForSection(sectionId) {
    const s = this._stmts.getSection.get(sectionId);
    return s ? s.slug : null;
  }

  /**
   * Import a per-person blob into an (empty) person. Dispatches on shape:
   * `variants` present → new normalized export; otherwise the legacy
   * {documents, resume_included} shape.
   */
  importPersonData(personId, data) {
    if (Array.isArray(data.variants)) return this._importNewShape(personId, data);
    return this.importLegacyData(personId, data);
  }

  _importNewShape(personId, data) {
    const tx = this.db.transaction(() => {
      if (data.personal) this.setPersonal(personId, data.personal);
      if (data.coverletter) {
        const header = {};
        for (const [k, v] of Object.entries(data.coverletter)) header['coverletter.' + k] = v;
        if (Object.keys(header).length) this.setPersonSettings(personId, header);
      }

      // Content, tracking ids by position for override mapping.
      const sectionIdBySlug = {};
      const entryIdByPos = {}; // `${slug}#${ei}` -> entryId
      const itemIdByPos = {}; // `${slug}#${ei}#${ii}` -> itemId
      for (const sec of (data.sections || [])) {
        const sectionId = this.createSection(personId, sec.slug, sec.type, sec.title || '');
        sectionIdBySlug[sec.slug] = sectionId;
        (sec.entries || []).forEach((e, ei) => {
          const entryId = this.createEntry(sectionId, e.fields || {});
          entryIdByPos[`${sec.slug}#${ei}`] = entryId;
          if (e.tags && e.tags.length) this.addEntryTags(entryId, e.tags);
          (e.items || []).forEach((it, ii) => {
            const itemId = this.createItem(entryId, it.content || '', it.title || '');
            itemIdByPos[`${sec.slug}#${ei}#${ii}`] = itemId;
            if (it.tags && it.tags.length) this.addItemTags(itemId, it.tags);
          });
        });
      }

      for (const v of (data.variants || [])) {
        const variantId = this.createVariant(personId, v.name, v.kind);
        if (v.rules) this.setVariantRules(variantId, v.rules);
        if (Array.isArray(v.sections)) {
          this.setVariantSections(variantId, v.sections
            .map((r) => ({ sectionId: sectionIdBySlug[r.slug], enabled: r.enabled, sortOrder: r.sortOrder }))
            .filter((r) => r.sectionId != null));
        }
        for (const o of (v.entryOverrides || [])) {
          const eid = entryIdByPos[`${o.slug}#${o.ei}`];
          if (eid != null) this.setEntryOverride(variantId, eid, { included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride });
        }
        for (const o of (v.itemOverrides || [])) {
          const iid = itemIdByPos[`${o.slug}#${o.ei}#${o.ii}`];
          if (iid != null) this.setItemOverride(variantId, iid, { included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride });
        }
        for (const s of (v.letterSections || [])) this.createLetterSection(variantId, s.title || '', s.body || '');
      }

      // Aliases (exported content is already canonical, so a plain upsert is
      // enough — no retroactive rewrite needed).
      for (const al of (data.tagAliases || [])) {
        const a = normTag(al.alias);
        const c = normTag(al.canonical);
        if (a && c && a !== c) this._stmts.upsertAlias.run(personId, a, c, al.source || 'manual');
      }

      // Catalog (already-canonical tags; plain upsert).
      for (const ce of (data.tagCatalog || [])) {
        const t = normTag(ce.tag);
        if (t) this._stmts.upsertCatalogTag.run(personId, t, ce.description ?? null, ce.category ?? null);
      }
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------------------

  /** Seed Jane Doe once, on a truly empty database. */
  seedJaneDoe() {
    if (this._stmts.countPersons.get().cnt > 0) return;
    const id = this.createPerson('Jane Doe');
    this.importLegacyData(id, JANE_DOE_DATA);
  }

  /**
   * Materialize a legacy export blob ({personal, sections, documents:{cv,resume},
   * coverletter}) into the normalized model for an existing (empty) person,
   * deriving CV / Resume / Cover Letter variants. Mirrors migration 007's
   * per-person backfill. Used for seeding and importing legacy backups.
   */
  importLegacyData(personId, data) {
    const tx = this.db.transaction(() => {
      // personal + coverletter header
      if (data.personal) this.setPersonal(personId, data.personal);
      if (data.coverletter) {
        const header = {};
        for (const [k, v] of Object.entries(data.coverletter)) {
          if (k === 'sections') continue;
          header['coverletter.' + k] = v;
        }
        if (Object.keys(header).length) this.setPersonSettings(personId, header);
      }

      const blobSections = Array.isArray(data.sections) ? data.sections : [];
      const cvDoc = (data.documents && Array.isArray(data.documents.cv)) ? data.documents.cv : [];
      const resumeDoc = (data.documents && Array.isArray(data.documents.resume)) ? data.documents.resume : [];

      // master order = cv order, then leftovers
      const orderedSlugs = [];
      for (const d of cvDoc) {
        if (blobSections.some((s) => s.id === d.sectionId) && !orderedSlugs.includes(d.sectionId)) {
          orderedSlugs.push(d.sectionId);
        }
      }
      for (const s of blobSections) if (!orderedSlugs.includes(s.id)) orderedSlugs.push(s.id);

      const sectionIdBySlug = {};
      const entryIdByOld = {};
      const itemIdByOld = {};
      const firstResumeEntryBySlug = {};

      for (const slug of orderedSlugs) {
        const sec = blobSections.find((s) => s.id === slug);
        const type = normalizeType(sec.type);
        const sectionId = this.createSection(personId, slug, type, sec.title || '');
        sectionIdBySlug[slug] = sectionId;
        const paragraph = getLatexType(type) === 'cvparagraph';

        for (const e of (sec.entries || [])) {
          const entryId = this.createEntry(sectionId, e.fields || {});
          if (e.id != null) entryIdByOld[e.id] = entryId;
          if (paragraph && e.resumeIncluded !== false && firstResumeEntryBySlug[slug] == null) {
            firstResumeEntryBySlug[slug] = entryId;
          }
          for (const it of (e.items || [])) {
            const itemId = this.createItem(entryId, it.content || '', it.title || '');
            if (it.id != null) itemIdByOld[it.id] = itemId;
          }
        }
      }

      // CV variant
      const cvId = this.createVariant(personId, 'CV', 'cv');
      this.setVariantSections(cvId, mapDocToVariantSections(cvDoc, sectionIdBySlug));

      // Resume variant
      const resumeId = this.createVariant(personId, 'Resume', 'resume');
      this.setVariantSections(resumeId, mapDocToVariantSections(resumeDoc, sectionIdBySlug));
      for (const sec of blobSections) {
        for (const e of (sec.entries || [])) {
          if (e.resumeIncluded === false && entryIdByOld[e.id] != null) {
            this.setEntryOverride(resumeId, entryIdByOld[e.id], { included: false });
          }
          for (const it of (e.items || [])) {
            if (it.resumeIncluded === false && itemIdByOld[it.id] != null) {
              this.setItemOverride(resumeId, itemIdByOld[it.id], { included: false });
            }
          }
        }
      }
      for (const d of resumeDoc) {
        if (d.resumeParagraphText != null && firstResumeEntryBySlug[d.sectionId] != null) {
          this.setEntryOverride(resumeId, firstResumeEntryBySlug[d.sectionId], { textOverride: d.resumeParagraphText });
        }
      }

      // Cover Letter variant (only if there are paragraphs)
      const clSections = (data.coverletter && Array.isArray(data.coverletter.sections)) ? data.coverletter.sections : [];
      if (clSections.length) {
        const clId = this.createVariant(personId, 'Cover Letter', 'coverletter');
        for (const s of clSections) this.createLetterSection(clId, s.title || '', s.body || '');
      }
    });
    tx();
  }

  /** Convenience for tests: remove all persons (cascades to all content). */
  clearAllContent() {
    const tx = this.db.transaction(() => {
      for (const pp of this._stmts.getPersons.all()) this._stmts.deletePerson.run(pp.id);
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close() {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row / shape helpers
// ---------------------------------------------------------------------------

function rowsToSettings(rows) {
  const out = {};
  for (const row of rows) {
    out[row.key] = (row.value_num != null && row.value_unit != null)
      ? { num: row.value_num, unit: row.value_unit }
      : row.value;
  }
  return out;
}

function stripPrefix(obj, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.startsWith(prefix) ? k.slice(prefix.length) : k] = v;
  return out;
}

/** Re-join {num,unit} setting objects into combined strings for the generator. */
function combineUnits(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = (v && typeof v === 'object' && 'num' in v) ? String(v.num) + v.unit : v;
  }
  return out;
}

function rowToSection(s) {
  return { id: s.id, personId: s.person_id, slug: s.slug, type: s.type, title: s.title, sortOrder: s.sort_order };
}

function rowToVariant(v) {
  return { id: v.id, personId: v.person_id, name: v.name, kind: v.kind, created_at: v.created_at };
}

function mapDocToVariantSections(docRows, sectionIdBySlug) {
  const out = [];
  for (const d of docRows) {
    const sectionId = sectionIdBySlug[d.sectionId];
    if (sectionId == null) continue;
    out.push({ sectionId, enabled: d.enabled !== false, sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : out.length });
  }
  return out;
}

/**
 * Canonicalize a tag for storage and exact matching. Conservative on purpose:
 * case, unicode accents, and separator STYLE (whitespace/underscore → hyphen)
 * are folded so "Front End", "front_end", and "front-end" converge — but
 * distinct words are never stemmed or merged ("java" ≠ "javascript"). Anything
 * looser (typos, true synonyms) is handled by fuzzy search + the alias map, not
 * here. Mirrored by the frozen snapshot in migrations/008_fuzzy_tags.js.
 */
function normTag(t) {
  return String(t)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // unify whitespace / underscores → hyphen
    .replace(/-+/g, '-') // collapse repeated hyphens
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

/** Flatten an entry's string field values into one text blob for suggestion. */
function entryText(fields) {
  return Object.values(fields || {}).filter((v) => typeof v === 'string').join(' ').trim();
}

/** Lexicographic ordering key: [effective sort, master sort, id]. */
function sortKey(override, master, id) {
  return [override != null ? override : master, master, id];
}

function bySort(a, b) {
  for (let i = 0; i < a._sort.length; i++) {
    if (a._sort[i] !== b._sort[i]) return a._sort[i] - b._sort[i];
  }
  return 0;
}

module.exports = CvDatabase;
