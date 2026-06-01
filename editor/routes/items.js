const express = require('express');
const { validate } = require('../lib/schema');
const { AppError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createItemsRouter(getDb) {
  const router = express.Router();

  router.put('/:id', validate('updateItem'), wrap((req, res) => {
    getDb().updateItem(intId(req.params.id), { content: req.body.content, title: req.body.title });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    getDb().deleteItem(intId(req.params.id));
    res.json({ success: true });
  }));

  router.post('/:id/tags', validate('addTags'), wrap((req, res) => {
    getDb().addItemTags(intId(req.params.id), req.body.tags);
    res.json({ success: true });
  }));

  router.delete('/:id/tags/:tag', wrap((req, res) => {
    getDb().removeItemTag(intId(req.params.id), req.params.tag);
    res.json({ success: true });
  }));

  return router;
};
