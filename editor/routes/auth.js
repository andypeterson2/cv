const express = require('express');
const wrap = require('../lib/async-handler');
const { AppError } = require('../lib/errors');

/**
 * Front-door user provisioning (multi-tenancy phase 2).
 *
 * The gateway drives "Sign in with Google", verifies the id_token, then calls this
 * to create-or-update the cv user for that Google `sub` and get back the cv user id
 * (which it stores in the session and injects as X-User-Id on later requests).
 *
 * This is the ONE endpoint that mints users, so it is NOT behind tokenAuth (there is
 * no user yet) — it is gated instead by the shared front-door secret (X-Origin-Secret),
 * exactly what cv's origin-guard also checks, so only a front door can reach it. It is
 * mounted before tokenAuth for that reason. Unset secret (local dev / tests) ⇒ open.
 */
module.exports = function createAuthRouter(getDb) {
  const router = express.Router();
  const secret = process.env.CV_ORIGIN_SECRET;

  router.post(
    '/upsert-user',
    wrap((req, res) => {
      if (secret && req.get('x-origin-secret') !== secret) {
        throw new AppError('Forbidden', 403);
      }
      const { googleSub, email = null, name = null } = req.body || {};
      if (!googleSub || typeof googleSub !== 'string') {
        throw new AppError('googleSub is required', 400);
      }
      const userId = getDb().upsertUser({ googleSub, email, name });
      res.json({ userId });
    }),
  );

  return router;
};
