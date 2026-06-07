/**
 * Tag subsystem for CvDatabase: tags, per-person aliases, the controlled-vocab
 * catalog, and suggestion. Mixed onto the prototype (see db.js / applyMixin), so
 * methods run with `this` === the CvDatabase instance (its prepared statements,
 * db handle, and cross-cluster reads like this.getSections/getSection).
 */
const { normTag, entryText } = require('./helpers');
const fuzzy = require('../fuzzy');
const suggest = require('../suggest');

class TagStore {
  // ---- Tags ----

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

  // ---- Tag aliases (per-person alias → canonical) ----

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

  // ---- Tag catalog (per-person controlled vocabulary) + suggestion ----

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

  /**
   * Suggest existing tags for a piece of text. Ranks the union of the catalog
   * (preferred) and the usage vocabulary; NEVER invents a tag. Approximate —
   * discovery/authoring only (lib/suggest.js). `scorer` (optional) swaps in an
   * alternate ranker (e.g. embeddings) without changing this method's shape.
   * @returns {Promise<{query, results:[{tag, score, inCatalog, count, via}]}>}
   */
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
}

module.exports = TagStore;
