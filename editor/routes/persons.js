const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, ConflictError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

module.exports = function createPersonsRouter(getDb) {
  const router = express.Router();

  router.get('/', wrap((req, res) => {
    const persons = getDb().getPersons();
    const activePersonId = getDb().getActivePersonId();
    res.json({ persons, activePersonId });
  }));

  router.post('/', validate('createPerson'), wrap((req, res) => {
    try {
      const id = getDb().createPerson(req.body.name);
      res.status(201).json({ id });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('Person with that name already exists');
      throw e;
    }
  }));

  router.put('/:id', validate('updatePerson'), wrap((req, res) => {
    try {
      const id = parseInt(req.params.id);
      getDb().renamePerson(id, req.body.name);
      res.json({ success: true });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('Person with that name already exists');
      throw e;
    }
  }));

  router.delete('/:id', wrap((req, res) => {
    try {
      const id = parseInt(req.params.id);
      getDb().deletePerson(id);
      res.json({ success: true });
    } catch (e) {
      if (e.message && e.message.includes('Cannot delete')) throw new AppError(e.message, 400);
      throw e;
    }
  }));

  router.post('/:id/switch', wrap((req, res) => {
    try {
      const id = parseInt(req.params.id);
      getDb().switchPerson(id);
      res.json({ success: true });
    } catch (e) {
      if (e.message && e.message.includes('not found')) throw new NotFoundError(e.message);
      throw e;
    }
  }));

  router.post('/:id/save', wrap((req, res) => {
    const id = parseInt(req.params.id);
    getDb().savePerson(id);
    res.json({ success: true });
  }));

  // Per-person JSON export. Mirrors GET /api/export but targets a specific
  // stored profile instead of the active one — useful for backups across the
  // whole roster without having to switch active person.
  //
  // For the active person the working tables are the source of truth, so we
  // read them live via getAllForExport() rather than the (possibly stale)
  // stored snapshot. This keeps the GET side-effect-free (no DB write).
  router.get('/:id/export', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw new AppError('Invalid person id', 400);

    const db = getDb();
    if (db.getActivePersonId() === id) {
      return res.json(db.getAllForExport());
    }
    const person = db.getPerson(id);
    if (!person) throw new NotFoundError('Person not found');
    res.json(person.data);
  }));

  return router;
};
