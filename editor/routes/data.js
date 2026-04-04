const express = require('express');
const { validate } = require('../lib/schema');
const wrap = require('../lib/async-handler');

module.exports = function createDataRouter(getDb) {
  const router = express.Router();

  router.post('/import', validate('importData'), wrap((req, res) => {
    getDb().importAll(req.body);
    const activeId = getDb().getActivePersonId();
    if (activeId) {
      getDb().savePerson(activeId);
    }
    res.json({ success: true });
  }));

  router.get('/export', wrap((req, res) => {
    res.json(getDb().getAllForExport());
  }));

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
      const sections = getDb().getSections();
      res.json({ status: 'ok', service: 'cv', sections: sections.length });
    } catch (e) {
      res.status(500).json({ status: 'error', service: 'cv', error: e.message });
    }
  });

  return router;
};
