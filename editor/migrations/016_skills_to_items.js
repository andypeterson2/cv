/**
 * 016 — Skills become item rows.
 *
 * A `cvskills` entry stored its whole skill list as one flat `fields.skills`
 * comma-string, so an individual skill had no id / tag / sort / per-variant
 * override. Split each skills entry's `fields.skills` into `items` rows (one per
 * skill, ordered by position) so skills gain the same per-skill tag / omit /
 * reorder machinery bullets already have (item_tags, item_overrides). The legacy
 * `fields.skills` string is dropped once split; render + frontend fall back to it
 * only for any un-split row (compat). Idempotent — skips entries that already
 * have items. Follows the 011 pattern: one transaction, run once by the runner.
 */
const { getLatexType } = require('../lib/latex-type-map');

module.exports = function migrate(db) {
  const tx = db.transaction(() => {
    const skillsSections = db
      .prepare('SELECT id, type FROM sections')
      .all()
      .filter((s) => getLatexType(s.type) === 'cvskills');

    const entriesFor = db.prepare('SELECT id, fields FROM entries WHERE section_id = ?');
    const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items WHERE entry_id = ?');
    const insertItem = db.prepare(
      'INSERT INTO items (entry_id, sort_order, content, title) VALUES (?, ?, ?, ?)',
    );
    const updateFields = db.prepare('UPDATE entries SET fields = ? WHERE id = ?');

    for (const s of skillsSections) {
      for (const e of entriesFor.all(s.id)) {
        if (itemCount.get(e.id).n > 0) continue; // already split — leave alone
        const fields = JSON.parse(e.fields || '{}');
        const skills = String(fields.skills || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        skills.forEach((skill, i) => insertItem.run(e.id, i, skill, ''));
        delete fields.skills;
        updateFields.run(JSON.stringify(fields), e.id);
      }
    }
  });
  tx();
};
