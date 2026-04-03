const express = require('express');
const { validate } = require('../lib/schema');
const { NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

module.exports = function createCoverletterRouter(getDb) {
  const router = express.Router();

  router.get('/', wrap((req, res) => {
    res.json(getDb().getCoverletterSections());
  }));

  router.post('/', validate('createCoverletterSection'), wrap((req, res) => {
    const id = getDb().createCoverletterSection(req.body.title, req.body.body);
    res.status(201).json({ id: Number(id) });
  }));

  router.put('/:id', validate('updateCoverletterSection'), wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = getDb().getCoverletterSections().find(s => s.id === id);
    if (!existing) throw new NotFoundError('Section not found');
    getDb().updateCoverletterSection(id, {
      title: req.body.title ?? existing.title,
      body: req.body.body ?? existing.body,
    });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    getDb().deleteCoverletterSection(id);
    res.json({ success: true });
  }));

  router.patch('/order', validate('reorder'), wrap((req, res) => {
    getDb().reorderCoverletterSections(req.body.ids);
    res.json({ success: true });
  }));

  return router;
};
