const express = require('express');
const { validate } = require('../lib/schema');
const wrap = require('../lib/async-handler');

module.exports = function createSettingsRouter(getDb) {
  const router = express.Router();

  router.get(
    '/',
    wrap((req, res) => {
      const prefix = req.query.prefix || null;
      res.json(getDb().getSettings(prefix));
    }),
  );

  router.patch(
    '/',
    validate('settings'),
    wrap((req, res) => {
      getDb().setSettings(req.body);
      res.json({ success: true });
    }),
  );

  return router;
};
