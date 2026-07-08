/**
 * 011 — Per-variant cover-letter headers.
 *
 * The letter header (recipient / address / opening / closing) was stored
 * per-person in `person_settings` as `coverletter.*`, so every one of a person's
 * cover letters shared a recipient. Give each `coverletter` variant its own
 * header, matching `variant_letter_sections` (the paragraphs — already
 * per-variant). The backfill copies the person header into every existing
 * coverletter variant (they all shared it), so nothing changes visually.
 *
 * Expand phase: the legacy `coverletter.*` person settings are left in place for
 * backward-compat and removed in a later contract migration. Follows the 010
 * pattern — DDL + data in one transaction, run once by the migration runner.
 */

const DDL = `
CREATE TABLE variant_letter_header (
  variant_id        INTEGER PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  recipient_name    TEXT NOT NULL DEFAULT '',
  recipient_address TEXT NOT NULL DEFAULT '',
  opening           TEXT NOT NULL DEFAULT '',
  closing           TEXT NOT NULL DEFAULT ''
);
`;

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    db.exec(DDL);

    const variants = db.prepare("SELECT id, person_id FROM variants WHERE kind = 'coverletter'").all();
    const getSetting = db.prepare('SELECT value FROM person_settings WHERE person_id = ? AND key = ?');
    const insert = db.prepare(
      `INSERT INTO variant_letter_header
         (variant_id, recipient_name, recipient_address, opening, closing)
       VALUES (?, ?, ?, ?, ?)`
    );
    const val = (pid, k) => getSetting.get(pid, 'coverletter.' + k)?.value ?? '';

    for (const v of variants) {
      insert.run(
        v.id,
        val(v.person_id, 'recipientName'),
        val(v.person_id, 'recipientAddress'),
        val(v.person_id, 'opening'),
        val(v.person_id, 'closing')
      );
    }
  });
  tx();
};
