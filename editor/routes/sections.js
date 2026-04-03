const express = require('express');
const { validate } = require('../lib/schema');
const { NotFoundError, ConflictError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

module.exports = function createSectionsRouter(getDb) {
  const router = express.Router();

  router.get('/', wrap((req, res) => {
    res.json(getDb().getSections());
  }));

  router.get('/:id', wrap((req, res) => {
    const section = getDb().getSection(req.params.id);
    if (!section) throw new NotFoundError('Section not found');
    res.json(section);
  }));

  router.post('/', validate('createSection'), wrap((req, res) => {
    try {
      getDb().createSection(req.body.id, req.body.type, req.body.title);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) throw new ConflictError('Section already exists');
      throw e;
    }
    res.status(201).json({ id: req.body.id });
  }));

  router.put('/:id', validate('updateSection'), wrap((req, res) => {
    getDb().updateSection(req.params.id, { title: req.body.title });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    getDb().deleteSection(req.params.id);
    res.json({ success: true });
  }));

  router.post('/:id/entries', validate('createEntry'), wrap((req, res) => {
    const entryId = getDb().createEntry(req.params.id, req.body.fields);
    res.status(201).json({ id: Number(entryId) });
  }));

  router.patch('/:id/entries/order', validate('reorder'), wrap((req, res) => {
    getDb().reorderEntries(req.params.id, req.body.ids);
    res.json({ success: true });
  }));

  return router;
};
