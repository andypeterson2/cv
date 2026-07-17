const express = require('express');
const { buildHealth } = require('../lib/health');

module.exports = function createDataRouter(getDb) {
  const router = express.Router();

  // Static catalogs the UI needs to render pickers (social fields, units, etc.).
  router.get('/catalog', (req, res) => {
    const { LATEX_TYPE_MAP, VALID_SEMANTIC_TYPES } = require('../lib/latex-type-map');
    res.json({
      socialCatalog: require('../lib/social-catalog'),
      latexUnits: require('../lib/latex-units'),
      identityExtras: require('../lib/identity-extras'),
      accentColors: require('../lib/accent-colors'),
      styleDefaults: require('../lib/style-defaults'),
      latexTypeMap: LATEX_TYPE_MAP,
      validSectionTypes: VALID_SEMANTIC_TYPES,
    });
  });

  router.get('/health', (req, res) => {
    try {
      res.json(buildHealth());
    } catch (e) {
      res.status(500).json({ error: { code: 'internal_error', message: e.message } });
    }
  });

  return router;
};
