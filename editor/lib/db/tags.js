/**
 * Tag subsystem for CvDatabase: tags, per-profile aliases, the controlled-vocab
 * catalog, and suggestion. Mixed onto the CvDatabase prototype, so methods run
 * with `this` === the CvDatabase instance (its prepared statements, db handle,
 * and cross-cluster reads like this.getSections/getSection).
 */
const { normTag, entryText } = require('./helpers');
const fuzzy = require('../fuzzy');
const suggest = require('../suggest');
const { SEED_TAGS, seedTag } = require('../seed-tags');
const { withNeighbours } = require('../neighbour-scorer');

// Below this many distinct tags of their own, a profile's suggestions also draw
// on the starter vocabulary.
const SEED_UNTIL = 30;

class TagStore {
  // Tags

  addEntryTags(entryId, tags) {
    const pid = this._stmts.profileForEntry.get(entryId)?.pid;
    const tx = this.db.transaction(() => {
      for (const t of tags) {
        const tag = this._canonicalTag(pid, t);
        if (!tag) continue;
        this._stmts.addEntryTag.run(entryId, tag);
        this._catalogSeedTag(pid, tag);
      }
    });
    tx();
  }

  removeEntryTag(entryId, tag) {
    const pid = this._stmts.profileForEntry.get(entryId)?.pid;
    this._stmts.delEntryTag.run(entryId, this._canonicalTag(pid, tag));
  }

  addItemTags(itemId, tags) {
    const pid = this._stmts.profileForItem.get(itemId)?.pid;
    const tx = this.db.transaction(() => {
      for (const t of tags) {
        const tag = this._canonicalTag(pid, t);
        if (!tag) continue;
        this._stmts.addItemTag.run(itemId, tag);
        this._catalogSeedTag(pid, tag);
      }
    });
    tx();
  }

  /** A starter tag joins the profile's catalog, with its description, on first use. */
  _catalogSeedTag(profileId, tag) {
    const seed = profileId == null ? null : seedTag(tag);
    if (seed)
      this._stmts.insertCatalogTagIfAbsent.run(profileId, tag, seed.description, seed.category);
  }

  removeItemTag(itemId, tag) {
    const pid = this._stmts.profileForItem.get(itemId)?.pid;
    this._stmts.delItemTag.run(itemId, this._canonicalTag(pid, tag));
  }

  /** Distinct tag vocabulary across a profile's entries + items. */
  listTags(profileId) {
    const set = new Set();
    for (const r of this._stmts.listEntryTags.all(profileId)) set.add(r.tag);
    for (const r of this._stmts.listItemTags.all(profileId)) set.add(r.tag);
    return [...set].sort();
  }

  /** Tag vocabulary with usage counts (entries + items): [{tag, count}], desc. */
  listTagsWithCounts(profileId) {
    const counts = new Map();
    for (const r of this._stmts.countEntryTags.all(profileId))
      counts.set(r.tag, (counts.get(r.tag) || 0) + r.cnt);
    for (const r of this._stmts.countItemTags.all(profileId))
      counts.set(r.tag, (counts.get(r.tag) || 0) + r.cnt);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  }

  /**
   * Fuzzy-rank a profile's tag vocabulary against a query string. Approximate —
   * for discovery and authoring only; never used by variant resolution. If the
   * query is itself an alias, its canonical is surfaced as an exact hit.
   * @returns {query, results:[{tag, score, count, via}]}
   */
  searchTags(profileId, query, { limit = 10, minScore = 0.3 } = {}) {
    const q = normTag(query);
    const vocab = this.listTagsWithCounts(profileId);
    let results = fuzzy.searchTags(q, vocab, { limit, minScore });

    // An alias's canonical is an exact intent match: surface it first (via:'alias',
    // score 1), replacing any coincidental string match for the same tag.
    const canonical = this._resolveAlias(profileId, q);
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

  // Tag aliases (per-profile alias → canonical)

  getTagAliases(profileId) {
    return this._stmts.getAliases.all(profileId);
  }

  /** Follow the alias chain to its terminal canonical (cycle-safe). */
  _resolveAlias(profileId, tag, _seen) {
    let cur = tag;
    const seen = _seen || new Set([cur]);
    for (let i = 0; i < 16; i++) {
      const row = this._stmts.getAlias.get(profileId, cur);
      if (!row || !row.canonical) return cur;
      if (seen.has(row.canonical)) return cur; // defensive — writes reject cycles
      seen.add(row.canonical);
      cur = row.canonical;
    }
    return cur;
  }

  /** Normalize a tag, then fold it through the alias map to its canonical. */
  _canonicalTag(profileId, tag) {
    const t = normTag(tag);
    if (!t || profileId == null) return t;
    return this._resolveAlias(profileId, t);
  }

  /**
   * Define alias → canonical for a profile and fold any existing `alias`-tagged
   * content/rules into `canonical` so the vocabulary converges. Both sides are
   * normalized first.
   * @throws AppError-like Error with .status on self-alias or cycle.
   */
  setTagAlias(profileId, alias, canonical, source = 'manual') {
    const a = normTag(alias);
    const c = normTag(canonical);
    if (!a || !c) {
      const e = new Error('alias and canonical must be non-empty after normalization');
      e.status = 400;
      throw e;
    }
    if (a === c) {
      const e = new Error('alias and canonical cannot be the same tag');
      e.status = 409;
      throw e;
    }
    // Reject cycles: canonical must not resolve back to alias.
    if (this._resolveAlias(profileId, c) === a) {
      const e = new Error(`alias "${a}" → "${c}" would create a cycle`);
      e.status = 409;
      throw e;
    }

    const tx = this.db.transaction(() => {
      this._stmts.upsertAlias.run(profileId, a, c, source);
      // Retroactively fold existing usage of `a` into `c`.
      this._stmts.rewriteEntryTag.run(c, a, profileId);
      this._stmts.delEntryTagP.run(a, profileId);
      this._stmts.rewriteItemTag.run(c, a, profileId);
      this._stmts.delItemTagP.run(a, profileId);
      this._stmts.rewriteRuleTag.run(c, a, profileId);
      this._stmts.delRuleTagP.run(a, profileId);
    });
    tx();
    return { alias: a, canonical: c };
  }

  deleteTagAlias(profileId, alias) {
    this._stmts.delAlias.run(profileId, normTag(alias));
  }

  // Tag catalog (per-profile controlled vocabulary) + suggestion

  getTagCatalog(profileId) {
    return this._stmts.getCatalog.all(profileId);
  }

  /**
   * Upsert a catalog entry. The tag is normalized + alias-folded via
   * _canonicalTag, so a catalog entry can never disagree with a stored tag's
   * canonical form.
   */
  setCatalogTag(profileId, tag, { description = null, category = null } = {}) {
    const t = this._canonicalTag(profileId, tag);
    if (!t) {
      const e = new Error('tag must be non-empty after normalization');
      e.status = 400;
      throw e;
    }
    this._stmts.upsertCatalogTag.run(profileId, t, description, category);
    return { tag: t };
  }

  deleteCatalogTag(profileId, tag) {
    this._stmts.delCatalogTag.run(profileId, this._canonicalTag(profileId, tag));
  }

  /** Opt-in bootstrap: promote the current usage vocabulary into the catalog. Returns {added}. */
  seedCatalogFromUsage(profileId) {
    const existing = new Set(this._stmts.getCatalog.all(profileId).map((r) => r.tag));
    let added = 0;
    const tx = this.db.transaction(() => {
      for (const { tag } of this.listTagsWithCounts(profileId)) {
        if (existing.has(tag)) continue;
        this._stmts.upsertCatalogTag.run(profileId, tag, null, null);
        added++;
      }
    });
    tx();
    return { added };
  }

  /**
   * Candidate vocab for suggestion: catalog (preferred) ∪ usage vocab, deduped by
   * tag, plus the starter vocabulary while the profile's own is under SEED_UNTIL.
   */
  _suggestCandidates(profileId) {
    const byTag = new Map();
    for (const c of this._stmts.getCatalog.all(profileId)) {
      byTag.set(c.tag, {
        tag: c.tag,
        count: 0,
        inCatalog: true,
        description: c.description || undefined,
      });
    }
    for (const { tag, count } of this.listTagsWithCounts(profileId)) {
      const cur = byTag.get(tag);
      if (cur) cur.count = count;
      else byTag.set(tag, { tag, count, inCatalog: false });
    }
    if (byTag.size < SEED_UNTIL) {
      for (const s of SEED_TAGS) {
        if (!byTag.has(s.tag)) {
          byTag.set(s.tag, { tag: s.tag, count: 0, inCatalog: false, description: s.description });
        }
      }
    }
    return [...byTag.values()];
  }

  /**
   * Record what a profile did with tag suggestions. Each event names an entry or
   * item of theirs; `rank` is its position in the suggestion list when the tag came
   * from one. Returns {recorded}.
   * @throws Error with .status 404 when a target is not the profile's.
   */
  recordTagEvents(profileId, events) {
    const owner = { entry: this._stmts.profileForEntry, item: this._stmts.profileForItem };
    const tx = this.db.transaction(() => {
      for (const e of events) {
        if (owner[e.target].get(e.id)?.pid !== profileId) {
          const err = new Error(`${e.target} ${e.id} not found`);
          err.status = 404;
          throw err;
        }
        const tag = this._canonicalTag(profileId, e.tag);
        this._stmts.insertTagEvent.run(profileId, e.target, e.id, tag, e.action, e.rank ?? null);
      }
    });
    tx();
    return { recorded: events.length };
  }

  /**
   * How suggestions are faring: accept and dismiss counts by rank, how often a
   * tag was typed by hand instead, and how many hand-typed tags had been shown.
   */
  tagEventStats(profileId) {
    const byRank = new Map();
    const totals = { accept: 0, dismiss: 0, manual: 0, remove: 0 };
    let manualShown = 0;
    for (const { action, rank, n } of this._stmts.tagEventCounts.all(profileId)) {
      totals[action] += n;
      if (action === 'manual' && rank != null) manualShown += n;
      if ((action === 'accept' || action === 'dismiss') && rank != null) {
        const row = byRank.get(rank) || { rank, accept: 0, dismiss: 0 };
        row[action] += n;
        byRank.set(rank, row);
      }
    }
    const rate = (a, b) => (a + b > 0 ? a / (a + b) : null);
    return {
      totals,
      byRank: [...byRank.values()]
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ ...r, acceptRate: rate(r.accept, r.dismiss) })),
      acceptRate: rate(totals.accept, totals.dismiss),
      manualShare: rate(totals.manual, totals.accept),
      manualShownShare: totals.manual > 0 ? manualShown / totals.manual : null,
    };
  }

  /**
   * Suggest existing tags for a piece of text. Ranks the union of the catalog
   * (preferred) and the usage vocabulary; never invents a tag. Approximate —
   * discovery/authoring only. `scorer` (optional) swaps in an
   * alternate ranker (e.g. embeddings) without changing this method's shape.
   * @returns {Promise<{query, results:[{tag, score, inCatalog, count, via}]}>}
   */
  async suggestTags(profileId, text, { limit = 8, minScore, scorer, embed } = {}) {
    const results = await suggest.suggestTags(text, this._suggestCandidates(profileId), {
      limit,
      minScore,
      scorer: this._personalScorer(profileId, scorer, embed),
    });
    return { query: String(text), results };
  }

  /** With an embedding function, blend the scorer with votes from the profile's tagged bullets. */
  _personalScorer(profileId, scorer, embed) {
    if (!scorer || !embed) return scorer;
    return withNeighbours(scorer, embed, this._taggedExamples(profileId));
  }

  /** The profile's tagged entries and bullets, as the text suggestion sees them. */
  _taggedExamples(profileId) {
    const examples = [];
    for (const s of this.getSections(profileId)) {
      for (const e of this.getSection(s.id).entries) {
        const eText = entryText(e.fields);
        if (eText && e.tags.length) examples.push({ text: eText, tags: e.tags });
        for (const it of e.items) {
          const iText = (it.content || '').trim();
          if (iText && it.tags.length) examples.push({ text: iText, tags: it.tags });
        }
      }
    }
    return examples;
  }

  /**
   * Suggest tags for every entry/item of a profile in one pass — the natural
   * step right after a legacy import that arrived untagged. Suggest-only: writes
   * nothing; returns candidates + the target's current tags so a confirmer
   * (an MCP client or the UI) can apply via addEntryTags/addItemTags. Candidate vocab is built
   * once and reused across items.
   */
  async suggestBulk(profileId, { limit = 5, minScore, scorer: base, embed } = {}) {
    const candidates = this._suggestCandidates(profileId);
    const scorer = this._personalScorer(profileId, base, embed);
    // Bulk runs are reviewed in one pass, so the lexical floor is stricter than a single suggest.
    const floor = minScore ?? (scorer ? undefined : 0.4);
    const out = [];
    for (const s of this.getSections(profileId)) {
      const full = this.getSection(s.id);
      for (const e of full.entries) {
        const eText = entryText(e.fields);
        if (eText) {
          out.push({
            target: 'entry',
            id: e.id,
            text: eText,
            current: e.tags,
            suggestions: await suggest.suggestTags(eText, candidates, {
              limit,
              minScore: floor,
              scorer,
            }),
          });
        }
        for (const it of e.items) {
          const iText = (it.content || '').trim();
          if (iText) {
            out.push({
              target: 'item',
              id: it.id,
              text: iText,
              current: it.tags,
              suggestions: await suggest.suggestTags(iText, candidates, {
                limit,
                minScore: floor,
                scorer,
              }),
            });
          }
        }
      }
    }
    return { count: out.length, items: out };
  }
}

module.exports = TagStore;
module.exports.SEED_UNTIL = SEED_UNTIL;
