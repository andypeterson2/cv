const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createEntriesRouter(getDb) {
  const router = express.Router();

  router.get(
    '/:id',
    wrap((req, res) => {
      const entry = getDb().getEntry(intId(req.params.id));
      if (!entry) throw new NotFoundError('Entry not found');
      res.json(entry);
    }),
  );

  router.put(
    '/:id',
    validate('updateEntry'),
    wrap((req, res) => {
      getDb().updateEntry(intId(req.params.id), { fields: req.body.fields });
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      getDb().deleteEntry(intId(req.params.id));
      res.json({ success: true });
    }),
  );

  // ---- items ----

  router.post(
    '/:id/items',
    validate('createItem'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      if (!getDb().getEntry(id)) throw new NotFoundError('Entry not found');
      res
        .status(201)
        .json({ id: Number(getDb().createItem(id, req.body.content, req.body.title || '')) });
    }),
  );

  router.patch(
    '/:id/items/order',
    validate('reorder'),
    wrap((req, res) => {
      getDb().reorderItems(intId(req.params.id), req.body.ids);
      res.json({ success: true });
    }),
  );

  // ---- tags ----

  router.post(
    '/:id/tags',
    validate('addTags'),
    wrap((req, res) => {
      getDb().addEntryTags(intId(req.params.id), req.body.tags);
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id/tags/:tag',
    wrap((req, res) => {
      getDb().removeEntryTag(intId(req.params.id), req.params.tag);
      res.json({ success: true });
    }),
  );

  return router;
};
