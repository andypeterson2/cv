/**
 * Real client IP behind the Cloudflare gateway, for use as a rate-limit key.
 *
 * Cloudflare sets (and overwrites) CF-Connecting-IP to the true client address, so
 * it can't be spoofed by the client; fall back to req.ip for local/direct requests.
 * Wrapped in express-rate-limit's `ipKeyGenerator` so IPv6 clients are bucketed by
 * subnet (and to satisfy the library's IPv6 keyGenerator validation). This keeps
 * per-IP limits per-client instead of collapsing into one bucket when every request
 * arrives via the gateway's single upstream IP.
 */
const { ipKeyGenerator } = require('express-rate-limit');

function clientIp(req) {
  return ipKeyGenerator(req.headers['cf-connecting-ip'] || req.ip);
}

module.exports = { clientIp };
