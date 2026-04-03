const express = require('express');
const { validate } = require('../lib/schema');
const wrap = require('../lib/async-handler');

module.exports = function createEntriesRouter(getDb) {
  const router = express.Router();

  router.put('/:id', validate('updateEntry'), wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    getDb().updateEntry(id, {
      fields: req.body.fields,
      resumeIncluded: req.body.resumeIncluded,
    });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    getDb().deleteEntry(id);
    res.json({ success: true });
  }));

  router.post('/:id/items', validate('createItem'), wrap((req, res) => {
    const entryId = parseInt(req.params.id, 10);
    const itemId = getDb().createItem(entryId, req.body.content, true, req.body.title || '');
    res.status(201).json({ id: Number(itemId) });
  }));

  router.patch('/:id/items/order', validate('reorder'), wrap((req, res) => {
    const entryId = parseInt(req.params.id, 10);
    getDb().reorderItems(entryId, req.body.ids);
    res.json({ success: true });
  }));

  return router;
};
