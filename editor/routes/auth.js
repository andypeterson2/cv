const express = require('express');
const wrap = require('../lib/async-handler');
const { AppError } = require('../lib/errors');
const { parseOriginSecrets, matchesOriginSecret } = require('../lib/origin-secret');

/**
 * Front-door user provisioning.
 *
 * The gateway calls this to create-or-update the cv user for a Google `sub` and get
 * back the cv user id, which it then injects as X-User-Id on that person's requests.
 * When it calls depends on the gateway's mode:
 *   - with access grants on (the gateway's ACCESS_GRANTS), signing in to the site
 *     makes no cv user at all. This is called only when the owner approves someone's
 *     request for the CV editor, and for the owner's own sign-in;
 *   - with grants off, it is called on every Google sign-in, as it always was.
 * The MCP worker calls it too, for the owner only (it is admin-gated there).
 * cv does not need to know which: it trusts any caller holding the front-door secret.
 *
 * This is the one endpoint that mints users, so it is not behind tokenAuth (there is
 * no user yet) — it is gated instead by the shared front-door secret (X-Origin-Secret),
 * exactly what cv's origin-guard also checks, so only a front door can reach it. It is
 * mounted before tokenAuth for that reason. Unset secret (local dev / tests) ⇒ open.
 *
 * The secret is a SET, so a sender still on the old value and one already on the new
 * value are both accepted while CV_ORIGIN_SECRET holds `old,new`.
 */
module.exports = function createAuthRouter(getDb) {
  const router = express.Router();
  const secrets = parseOriginSecrets(process.env.CV_ORIGIN_SECRET);

  router.post(
    '/upsert-user',
    wrap((req, res) => {
      if (secrets.length > 0 && !matchesOriginSecret(req.get('x-origin-secret'), secrets)) {
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
