/**
 * 012 — Contract phase of the per-variant cover-letter header split (design #14).
 *
 * The header now lives in `variant_letter_header` (migration 011) and the
 * frontend writes it per-variant, so the legacy per-person `coverletter.*` rows
 * in `person_settings` are dead. Drop them. Migration 011 already backfilled them
 * into each coverletter variant, so no data is lost.
 */
module.exports = function migrate(db) {
  db.prepare("DELETE FROM person_settings WHERE key LIKE 'coverletter.%'").run();
};
