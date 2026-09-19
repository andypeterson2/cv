const express = require('express');
const { validate } = require('../lib/schema');
const { AppError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const { ownedResourceGuard } = require('../lib/owned-resource');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createItemsRouter(getDb) {
  const router = express.Router();

  // Ownership gate: every route here writes, so each one needs the caller to own
  // the item's person. `userId` comes from attachUser (req.userId).
  const requireItem = ownedResourceGuard(getDb, 'item', 'Item');

  router.put(
    '/:id',
    validate('updateItem'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireItem(id, req.userId);
      getDb().updateItem(id, {
        content: req.body.content,
        title: req.body.title,
      });
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireItem(id, req.userId);
      getDb().deleteItem(id);
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/tags',
    validate('addTags'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireItem(id, req.userId);
      getDb().addItemTags(id, req.body.tags);
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:id/tags/:tag',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireItem(id, req.userId);
      getDb().removeItemTag(id, req.params.tag);
      res.json({ success: true });
    }),
  );

  return router;
};
