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

  return router;
};
