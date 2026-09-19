const express = require('express');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError, ConflictError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const { ownedResourceGuard } = require('../lib/owned-resource');

function intId(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError('Invalid id', 400);
  return n;
}

module.exports = function createSectionsRouter(getDb) {
  const router = express.Router();

  // Ownership gate: writes need the caller to own the section's person, reads also
  // pass for a public person. `userId` comes from attachUser (req.userId).
  const requireSection = ownedResourceGuard(getDb, 'section', 'Section');

  router.get(
    '/:id',
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireSection(id, req.userId, { write: false });
      const section = getDb().getSection(id);
      if (!section) throw new NotFoundError('Section not found');
      res.json(section);
    }),
  );

  router.put(
    '/:id',
    validate('updateSection'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireSection(id, req.userId);
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
      const id = intId(req.params.id);
      requireSection(id, req.userId);
      getDb().deleteSection(id);
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/entries',
    validate('createEntry'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireSection(id, req.userId);
      res.status(201).json({ id: Number(getDb().createEntry(id, req.body.fields)) });
    }),
  );

  router.patch(
    '/:id/entries/order',
    validate('reorder'),
    wrap((req, res) => {
      const id = intId(req.params.id);
      requireSection(id, req.userId);
      getDb().reorderEntries(id, req.body.ids);
      res.json({ success: true });
    }),
  );

  return router;
};
