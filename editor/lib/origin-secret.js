/**
 * The set of accepted origin secrets.
 *
 * Both front doors present `X-Origin-Secret`, and cv checks it in four places, so
 * every sender has to agree with cv at once. Accepting a comma-separated set removes
 * that outage window: set `CV_ORIGIN_SECRET` to `old,new`, move each sender to `new`
 * one at a time, then drop `old`. A single value behaves as a plain equality check.
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
