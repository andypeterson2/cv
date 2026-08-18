/**
 * Origin-secret SET (tech-debt #7 — zero-downtime rotation).
 *
 * Both front doors — the api.andypeterson.dev gateway Worker and the MCP Worker —
 * present `X-Origin-Secret`, and cv checks it in THREE places: the origin guard (the
 * front-door gate), `tokenAuth`, and `attachUser` (trusting an injected `X-User-Id`).
 * The secret therefore lives in 4 spots that must agree — a drift used to mean every
 * proxied request 403s until you fix it.
 *
 * Making cv accept a comma-separated SET removes the outage window: to rotate, set cv's
 * `CV_ORIGIN_SECRET` to `old,new` (cv now accepts both), flip each sender to `new` one at
 * a time (each still works), then drop `old`. No moment where a sender and cv disagree.
 * A single value (the normal case, no comma) behaves exactly as a plain equality check.
 */
function parseOriginSecrets(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if `provided` is one of the accepted secrets (`secrets` = a parsed array). */
function matchesOriginSecret(provided, secrets) {
  return typeof provided === 'string' && provided.length > 0 && secrets.includes(provided);
}

module.exports = { parseOriginSecrets, matchesOriginSecret };
