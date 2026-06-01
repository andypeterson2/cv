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
    res.json({ tags: getDb().listTags(id) });
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
