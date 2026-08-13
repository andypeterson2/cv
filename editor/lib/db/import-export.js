/**
 * Export / import / seeding for CvDatabase. Per-person export uses the normalized
 * "new" shape (overrides addressed by position so backups survive re-import);
 * import dispatches between the new shape and the legacy {documents} shape, and
 * seeding materializes Jane Doe on an empty DB. Mixed onto the prototype (see
 * db.js / applyMixin); methods run with `this` === the CvDatabase instance.
 */
const { normTag, mapDocToVariantSections } = require('./helpers');
const { getLatexType, normalizeType } = require('../latex-type-map');
const { JANE_DOE_DATA } = require('../seed-data');

class ImportExport {
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
        if (pos) entryOverrides.push({ ...pos, included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride, fieldsOverride: o.fieldsOverride });
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
        header: v.kind === 'coverletter' ? this.getLetterHeader(v.id) : undefined,
      };
    });

    return {
      name: person.name,
      personal: this.getPersonal(personId),
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
          if (eid != null) this.setEntryOverride(variantId, eid, { included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride, fieldsOverride: o.fieldsOverride });
        }
        for (const o of (v.itemOverrides || [])) {
          const iid = itemIdByPos[`${o.slug}#${o.ei}#${o.ii}`];
          if (iid != null) this.setItemOverride(variantId, iid, { included: o.included, textOverride: o.textOverride, sortOverride: o.sortOverride });
        }
        for (const s of (v.letterSections || [])) this.createLetterSection(variantId, s.title || '', s.body || '');
        // per-variant header; older exports carried it once at the top level (data.coverletter)
        const header = v.header || (v.kind === 'coverletter' ? data.coverletter : null);
        if (header) this.setLetterHeader(variantId, header);
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

  // ---- seeding ----

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
      // personal (the cover-letter header is applied to the letter variant below)
      if (data.personal) this.setPersonal(personId, data.personal);

      const blobSections = Array.isArray(data.sections) ? data.sections : [];
      const cvDoc = (data.documents && Array.isArray(data.documents.cv)) ? data.documents.cv : [];
      const resumeDoc = (data.documents && Array.isArray(data.documents.resume)) ? data.documents.resume : [];

      // main order = cv order, then leftovers
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
        if (data.coverletter) this.setLetterHeader(clId, data.coverletter); // header (ignores `sections`)
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
}

module.exports = ImportExport;
