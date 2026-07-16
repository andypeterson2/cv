const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, ConflictError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const linkedin = require('../lib/linkedin');

/** Parse a numeric :pid / :id route param or throw 400. */
function intParam(value, label = 'id') {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError(`Invalid ${label}`, 400);
  return n;
}

/**
 * Map a `scorer` request param to a scorer function for db.suggestTags.
 * 'lexical' (or absent) → undefined (the default lexical scorer in suggest.js).
 * 'embedding' → the optional Phase-B module, lazy-required so it (and its model)
 * never load unless explicitly requested.
 */
function resolveScorer(name) {
  if (name !== 'embedding') return undefined;
  let mod;
  try {
    mod = require('../lib/embed-scorer');
  } catch {
    throw new AppError('Embedding scorer is not available on this deployment', 501);
  }
  return mod.scorer;
}

module.exports = function createPersonsRouter(getDb) {
  const router = express.Router();

  const requirePerson = (id) => {
    const person = getDb().getPerson(id);
    if (!person) throw new NotFoundError('Person not found');
    return person;
  };

  // ---- Person CRUD ----

  router.get('/', wrap((req, res) => {
    res.json({ persons: getDb().getPersons() });
  }));

  router.post('/', validate('createPerson'), wrap((req, res) => {
    try {
      res.status(201).json({ id: Number(getDb().createPerson(req.body.name)) });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('Person with that name already exists');
      throw e;
    }
  }));

  // Full main content (sections → entries → items → tags, variants, tag vocab).
  router.get('/:pid', wrap((req, res) => {
    const main = getDb().getMain(intParam(req.params.pid, 'person id'));
    if (!main) throw new NotFoundError('Person not found');
    res.json(main);
  }));

  router.put('/:pid', validate('updatePerson'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    try {
      getDb().renamePerson(id, req.body.name);
      res.json({ success: true });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('Person with that name already exists');
      throw e;
    }
  }));

  router.delete('/:pid', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().deletePerson(id);
    res.json({ success: true });
  }));

  // ---- Personal info ----

  router.get('/:pid/personal', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json(getDb().getPersonal(id));
  }));

  router.patch('/:pid/personal', validate('personal'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().setPersonal(id, req.body);
    res.json({ success: true });
  }));

  // The cover-letter header moved to a per-variant table + PATCH
  // /variants/:id/header (design #14); the old per-person route is gone.

  // ---- Export / import ----

  router.get('/:pid/export', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    const data = getDb().getPersonExport(id);
    if (!data) throw new NotFoundError('Person not found');
    res.json(data);
  }));

  router.post('/:pid/import', validate('import'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().importPersonData(id, req.body);
    res.json({ success: true });
  }));

  // ---- Version history (ADR-006 increment 1) ----
  // Reads of a public person's list stay open; snapshot + restore are writes, so
  // tokenAuth gates them to the owner (see server.js). A checkpoint snapshots the
  // person's authoritative state server-side; restore re-imports it over the person.

  router.get('/:pid/versions', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json({ versions: getDb().listVersions(id) });
  }));

  // One checkpoint in full, including its doc snapshot (for the diff view).
  router.get('/:pid/versions/:vid', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    const vid = intParam(req.params.vid, 'version id');
    requirePerson(id);
    const version = getDb().getVersion(id, vid);
    if (!version) throw new NotFoundError('Version not found');
    res.json(version);
  }));

  router.post('/:pid/versions', validate('createVersion'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const b = req.body || {};
    const vid = getDb().createVersion(id, b.label || '', b.branch || 'main', b.parent ?? null);
    res.status(201).json({ id: Number(vid) });
  }));

  router.post('/:pid/versions/:vid/restore', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    const vid = intParam(req.params.vid, 'version id');
    requirePerson(id);
    if (!getDb().restoreVersion(id, vid)) throw new NotFoundError('Version not found');
    res.json({ success: true });
  }));

  // Tag a checkpoint with a frozen provenance name (ADR-006 inc 3).
  router.post('/:pid/versions/:vid/tag', validate('tagVersion'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    const vid = intParam(req.params.vid, 'version id');
    requirePerson(id);
    if (!getDb().setTag(id, vid, (req.body && req.body.tag) || '')) {
      throw new NotFoundError('Version not found');
    }
    res.json({ success: true });
  }));

  // ---- Tag vocabulary ----

  router.get('/:pid/tags', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    if (req.query.withCounts) {
      res.json({ tags: getDb().listTagsWithCounts(id) });
    } else {
      res.json({ tags: getDb().listTags(id) });
    }
  }));

  // Fuzzy tag search — approximate, for discovery/authoring (NOT resolution).
  router.get('/:pid/tags/search', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const q = req.query.q;
    if (typeof q !== 'string' || !q.trim()) throw new AppError('Query param "q" is required', 400);
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 10;
    const minScore = req.query.min_score !== undefined ? parseFloat(req.query.min_score) : 0.3;
    res.json(getDb().searchTags(id, q, {
      limit: Number.isFinite(limit) ? limit : 10,
      minScore: Number.isFinite(minScore) ? minScore : 0.3,
    }));
  }));

  // ---- Tag aliases (alias → canonical; folded in at tag/rule write time) ----

  router.get('/:pid/tag-aliases', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json({ aliases: getDb().getTagAliases(id) });
  }));

  router.put('/:pid/tag-aliases', validate('setTagAlias'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const result = getDb().setTagAlias(id, req.body.alias, req.body.canonical);
    res.json({ success: true, ...result });
  }));

  router.delete('/:pid/tag-aliases/:alias', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().deleteTagAlias(id, req.params.alias);
    res.json({ success: true });
  }));

  // ---- Tag catalog (per-person controlled vocabulary; soft guide) ----

  router.get('/:pid/tags/catalog', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json({ catalog: getDb().getTagCatalog(id) });
  }));

  router.put('/:pid/tags/catalog', validate('setCatalogTag'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const result = getDb().setCatalogTag(id, req.body.tag, {
      description: req.body.description ?? null,
      category: req.body.category ?? null,
    });
    res.json({ success: true, ...result });
  }));

  router.delete('/:pid/tags/catalog/:tag', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().deleteCatalogTag(id, req.params.tag);
    res.json({ success: true });
  }));

  router.post('/:pid/tags/catalog/seed', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json({ success: true, ...getDb().seedCatalogFromUsage(id) });
  }));

  // ---- Tag suggestion (free text → ranked EXISTING tags; discovery only) ----

  router.post('/:pid/tags/suggest', validate('suggestTags'), wrap(async (req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const { text, limit, minScore, scorer } = req.body;
    res.json(await getDb().suggestTags(id, text, { limit, minScore, scorer: resolveScorer(scorer) }));
  }));

  // Suggest tags for EVERY entry/item at once (e.g. after an untagged import).
  // Suggest-only; all fields optional so an empty body is fine.
  router.post('/:pid/tags/suggest-bulk', wrap(async (req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const b = req.body || {};
    const opts = { scorer: resolveScorer(b.scorer) };
    if (b.limit !== undefined) opts.limit = b.limit;
    if (b.minScore !== undefined) opts.minScore = b.minScore;
    res.json(await getDb().suggestBulk(id, opts));
  }));

  // ---- Sections (person-scoped list + create + reorder) ----

  router.get('/:pid/sections', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json(getDb().getSections(id));
  }));

  router.post('/:pid/sections', validate('createSection'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    try {
      const sectionId = getDb().createSection(id, req.body.slug, req.body.type, req.body.title);
      res.status(201).json({ id: Number(sectionId) });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('A section with that slug already exists');
      throw e;
    }
  }));

  router.patch('/:pid/sections/order', validate('reorder'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().reorderSections(id, req.body.ids);
    res.json({ success: true });
  }));

  // ---- Variants (person-scoped list + create) ----

  router.get('/:pid/variants', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    res.json(getDb().getVariants(id));
  }));

  router.post('/:pid/variants', validate('createVariant'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    try {
      const variantId = getDb().createVariant(id, req.body.name, req.body.kind);
      res.status(201).json({ id: Number(variantId) });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('A variant with that name already exists');
      throw e;
    }
  }));

  // ---- LinkedIn / Indeed / Handshake export + drift tracking ----
  // Turn a resolved variant into paste-ready work-history blocks (lib/linkedin) and
  // track a per-entry fingerprint so status names exactly which positions drifted
  // since the last paste. Person-scoped ON PURPOSE: a non-public person's blocks
  // stay behind tokenAuth's /persons/<id> read-gate — a /variants/:id GET would not.
  // `variant` selects the lens (default: the person's cv-kind variant, else first).

  const pickVariant = (pid, raw) => {
    const variants = getDb().getVariants(pid);
    if (raw != null && raw !== '') {
      const v = variants.find((x) => x.id === intParam(raw, 'variant id'));
      if (!v) throw new NotFoundError('Variant not found for this person');
      return v.id;
    }
    const v = variants.find((x) => x.kind === 'cv') || variants[0];
    if (!v) throw new NotFoundError('No variant to export');
    return v.id;
  };

  const FORMATS = new Set(['linkedin', 'plaintext', 'markdown']);

  router.get('/:pid/linkedin', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const variantId = pickVariant(id, req.query.variant);
    const format = FORMATS.has(req.query.format) ? req.query.format : 'linkedin';
    res.json({ variantId, ...linkedin.exportLinkedin(getDb().resolveVariant(variantId), format) });
  }));

  router.get('/:pid/linkedin/status', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const variantId = pickVariant(id, req.query.variant);
    const { positions } = linkedin.exportLinkedin(getDb().resolveVariant(variantId));
    res.json({ variantId, positions: getDb().linkedinStatus(id, positions) });
  }));

  router.post('/:pid/linkedin/mark-synced', wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    const b = req.body || {};
    const variantId = pickVariant(id, b.variant);
    const { positions } = linkedin.exportLinkedin(getDb().resolveVariant(variantId));
    const only = Array.isArray(b.entryIds) && b.entryIds.length ? new Set(b.entryIds) : null;
    const entries = positions
      .filter((p) => !only || only.has(p.entryId))
      .map((p) => ({ entryId: p.entryId, fingerprint: p.fingerprint }));
    const marked = getDb().markLinkedinSynced(id, entries, new Date().toISOString());
    res.json({ variantId, marked });
  }));

  return router;
};

module.exports.intParam = intParam;
