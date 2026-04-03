const express = require('express');
const { validate } = require('../lib/schema');
const wrap = require('../lib/async-handler');

module.exports = function createItemsRouter(getDb) {
  const router = express.Router();

  router.put('/:id', validate('updateItem'), wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    getDb().updateItem(id, {
      content: req.body.content,
      resumeIncluded: req.body.resumeIncluded,
      title: req.body.title,
    });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    getDb().deleteItem(id);
    res.json({ success: true });
  }));

  return router;
};
