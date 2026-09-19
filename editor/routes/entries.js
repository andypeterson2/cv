const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const { ownedResourceGuard } = require('../lib/owned-resource');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createEntriesRouter(getDb) {
  const router = express.Router();

  // Ownership gate: writes need the caller to own the entry's person, reads also
  // pass for a public person. `userId` comes from attachUser (req.userId).
  const requireEntry = ownedResourceGuard(getDb, 'entry', 'Entry');

  router.get(
    '/:id',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId, { write: false });
      const entry = getDb().getEntry(id);
      if (!entry) throw new NotFoundError('Entry not found');
      res.json(entry);
    }),
  );

  router.put(
    '/:id',
    validate('updateEntry'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      getDb().updateEntry(id, { fields: req.body.fields });
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      getDb().deleteEntry(id);
      res.json({ success: true });
    }),
  );

  // items

  router.post(
    '/:id/items',
    validate('createItem'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      res
        .status(201)
        .json({ id: Number(getDb().createItem(id, req.body.content, req.body.title || '')) });
    }),
  );

  router.patch(
    '/:id/items/order',
    validate('reorder'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      getDb().reorderItems(id, req.body.ids);
      res.json({ success: true });
    }),
  );

  // tags

  router.post(
    '/:id/tags',
    validate('addTags'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      getDb().addEntryTags(id, req.body.tags);
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id/tags/:tag',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireEntry(id, req.userId);
      getDb().removeEntryTag(id, req.params.tag);
      res.json({ success: true });
    }),
  );

  return router;
};
