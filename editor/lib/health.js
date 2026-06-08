const pkg = require('../package.json');

/**
 * Build the standard `/health` body for the cv backend.
 *
 * Shape follows the cross-repo contract (website `docs/api-contract/CONTRACT.md`):
 * `{status, service, version, uptime_s}`. The extra `persons` count is allowed
 * by the schema and kept for the existing integration test.
 *
 * @param {() => {getPersons: () => unknown[]}} getDb Lazy DB accessor.
 */
function buildHealth(getDb) {
  return {
    status: 'ok',
    service: 'cv',
    version: pkg.version,
    uptime_s: Math.round(process.uptime() * 10) / 10,
    persons: getDb().getPersons().length,
  };
}

module.exports = { buildHealth };
