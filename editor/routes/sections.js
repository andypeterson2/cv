const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError, ConflictError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createSectionsRouter(getDb) {
  const router = express.Router();

  router.get(
    '/:id',
    wrap((req, res) => {
      const section = getDb().getSection(intId(req.params.id));
      if (!section) throw new NotFoundError('Section not found');
      res.json(section);
    }),
  );

  router.put(
    '/:id',
    validate('updateSection'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      if (!getDb().getSection(id)) throw new NotFoundError('Section not found');
      try {
        getDb().updateSection(id, req.body);
        res.json({ success: true });
      } catch (e) {
        if (e.message && e.message.includes('UNIQUE'))
          throw new ConflictError('A section with that slug already exists');
        throw e;
      }
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      getDb().deleteSection(intId(req.params.id));
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/entries',
    validate('createEntry'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      if (!getDb().getSection(id)) throw new NotFoundError('Section not found');
      res.status(201).json({ id: Number(getDb().createEntry(id, req.body.fields)) });
    }),
  );

  router.patch(
    '/:id/entries/order',
    validate('reorder'),
    wrap((req, res) => {
      getDb().reorderEntries(intId(req.params.id), req.body.ids);
      res.json({ success: true });
    }),
  );

  return router;
};
