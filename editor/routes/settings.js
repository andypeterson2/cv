const express = require('express');
const { validate } = require('../lib/schema');
const wrap = require('../lib/async-handler');

/**
 * Style, spacing and font settings for the calling account. `req.userId` comes from
 * attachUser, and every read and write is keyed on it, so one account's choices never
 * reach another's compiled documents.
 */
module.exports = function createSettingsRouter(getDb) {
  const router = express.Router();

  router.get(
    '/',
    wrap((req, res) => {
      const prefix = req.query.prefix || null;
      res.json(getDb().getSettings(prefix, req.userId));
    }),
  );

  router.patch(
    '/',
    validate('settings'),
    wrap((req, res) => {
      getDb().setSettings(req.body, req.userId);
      res.json({ success: true });
    }),
  );

  return router;
};
