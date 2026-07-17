const pkg = require('../package.json');

/**
 * Build the standard `/health` body for the cv backend.
 *
 * Shape follows the cross-repo contract (website `docs/api-contract/CONTRACT.md`):
 * `status` + `service` always, plus `version` + `uptime_s` when status is ok.
 *
 * Keep this MINIMAL. The contract allows extra service-specific keys, but this is
 * the one endpoint the origin guard leaves publicly reachable — the container
 * HEALTHCHECK hits it from 127.0.0.1 with no front-door header, so it can't be gated
 * (see lib/origin-guard.js). Whatever it returns is world-readable, forever, to
 * anyone who asks. So it states liveness and nothing else.
 *
 * It used to report `persons` (the profile count), telling the internet how many CVs
 * live here. No consumer wanted it — the contract doesn't ask for it and nothing read
 * it. Don't add data-shaped facts back.
 */
function buildHealth() {
  return {
    status: 'ok',
    service: 'cv',
    version: pkg.version,
    uptime_s: Math.round(process.uptime() * 10) / 10,
  };
}

module.exports = { buildHealth };
