/**
 * Renames persons to profiles throughout the schema: the `persons` and
 * `person_settings` tables, every `person_id` column, and the indexes named after
 * them. RENAME TABLE and RENAME COLUMN rewrite the foreign keys and index
 * definitions that reference them, so no table is rebuilt. Runs in a transaction
 * and checks the foreign keys before committing.
 */
const COLUMNS = [
  'profile_settings',
  'sections',
  'variants',
  'tag_aliases',
  'tag_catalog',
  'versions',
  'linkedin_sync',
  'tag_events',
];

const INDEXES = [
  ['idx_persons_user', 'idx_profiles_user', 'profiles(user_id)'],
  ['idx_sections_person', 'idx_sections_profile', 'sections(profile_id, sort_order)'],
  ['idx_variants_person', 'idx_variants_profile', 'variants(profile_id)'],
  ['idx_versions_person', 'idx_versions_profile', 'versions(profile_id, id DESC)'],
  ['idx_tag_events_person', 'idx_tag_events_profile', 'tag_events(profile_id, created_at)'],
];

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    db.exec('ALTER TABLE persons RENAME TO profiles');
    db.exec('ALTER TABLE person_settings RENAME TO profile_settings');
    for (const table of COLUMNS) {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN person_id TO profile_id`);
    }
    for (const [from, to, on] of INDEXES) {
      db.exec(`DROP INDEX IF EXISTS ${from}`);
      db.exec(`CREATE INDEX IF NOT EXISTS ${to} ON ${on}`);
    }
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error(`027: ${bad.length} foreign key violation(s) after rename`);
  });
  tx();
};
