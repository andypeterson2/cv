/**
 * Real client IP, for use as a rate-limit key.
 *
 * CF-Connecting-IP is only trustworthy when Cloudflare is the hop in front of this
 * process: Cloudflare sets and overwrites the header at its edge, so a client cannot
 * choose its own value. Any other front door — the Caddy reverse proxy, a direct
 * request — passes whatever the client sent straight through, and trusting it there
 * lets one client rotate the header and hand itself a fresh rate-limit bucket per
 * request. CV_TRUST_CF_IP=true switches the header on; otherwise the key is req.ip.
 *
 * Wrapped in express-rate-limit's `ipKeyGenerator` so IPv6 clients are bucketed by
 * subnet (and to satisfy the library's IPv6 keyGenerator validation). This keeps
 * per-IP limits per-client instead of collapsing into one bucket when every request
 * arrives via a single upstream IP.
 */
const { ipKeyGenerator } = require('express-rate-limit');

function trustsCloudflare() {
  return process.env.CV_TRUST_CF_IP === 'true';
}

function clientIp(req) {
  const forwarded = trustsCloudflare() ? req.headers['cf-connecting-ip'] : null;
  return ipKeyGenerator(forwarded || req.ip);
}

module.exports = { clientIp };
