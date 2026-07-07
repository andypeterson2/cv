const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, ConflictError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

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

  // Full master content (sections → entries → items → tags, variants, tag vocab).
  router.get('/:pid', wrap((req, res) => {
    const master = getDb().getMaster(intParam(req.params.pid, 'person id'));
    if (!master) throw new NotFoundError('Person not found');
    res.json(master);
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

  // ---- Cover-letter header (recipient / salutation / closing, per-person) ----

  router.patch('/:pid/coverletter', validate('coverletter'), wrap((req, res) => {
    const id = intParam(req.params.pid, 'person id');
    requirePerson(id);
    getDb().setCoverletterHeader(id, req.body);
    res.json({ success: true });
  }));

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

  return router;
};

module.exports.intParam = intParam;
