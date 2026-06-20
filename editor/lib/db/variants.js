/**
 * Variant subsystem for CvDatabase: variant CRUD, tag rules (+ author-time fuzzy
 * expansion), section lists, per-entry/item overrides, cover-letter paragraphs,
 * and resolution (variant → compile-ready data for lib/generator). Mixed onto the
 * prototype (see db.js / applyMixin); methods run with `this` === the instance.
 */
const { rowToVariant, stripPrefix, combineUnits, sortKey, bySort } = require('./helpers');
const { VARIANT_KINDS: KINDS } = require('@cv/constants');
const fuzzy = require('../fuzzy');
const { getLatexType } = require('../latex-type-map');

class VariantStore {
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

  // ---- resolution — variant → compile-ready data for lib/generator ----

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
}

module.exports = VariantStore;
