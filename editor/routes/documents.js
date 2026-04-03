const express = require('express');
const { validate, isValidVariant, VALID_VARIANTS } = require('../lib/schema');
const { AppError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

module.exports = function createDocumentsRouter(getDb) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(VALID_VARIANTS);
  });

  router.get('/:variant', wrap((req, res) => {
    const { variant } = req.params;
    if (!isValidVariant(variant)) throw new AppError('Invalid variant', 400);
    res.json({ variant, sections: getDb().getDocumentSections(variant) });
  }));

  router.put('/:variant', validate('documentSections'), wrap((req, res) => {
    const { variant } = req.params;
    if (!isValidVariant(variant)) throw new AppError('Invalid variant', 400);
    getDb().setDocumentSections(variant, req.body.sections);
    res.json({ success: true });
  }));

  return router;
};
