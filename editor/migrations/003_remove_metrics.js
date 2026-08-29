/**
 * Migration: Inline metric values into item content and drop the metrics table.
 *
 * Replaces \commandName{} and \commandName (when not followed by a letter)
 * in items.content and entries.fields with the metric's actual value.
 */
module.exports = function migrate(db) {
  // Check if metrics table exists
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metrics'")
    .get();
  if (!tableExists) return;

  const metrics = db.prepare('SELECT command, value FROM metrics').all();
  if (metrics.length === 0) {
    db.exec('DROP TABLE IF EXISTS metrics');
    db.exec('DROP INDEX IF EXISTS idx_metrics_section');
    return;
  }

  // Build replacement pairs: \command{} -> value, \command (non-alpha boundary) -> value
  const items = db.prepare('SELECT id, content FROM items').all();
  const updateItem = db.prepare('UPDATE items SET content = ? WHERE id = ?');

  const entries = db.prepare('SELECT id, fields FROM entries').all();
  const updateEntry = db.prepare('UPDATE entries SET fields = ? WHERE id = ?');

  function replaceMetrics(text) {
    if (!text) return text;
    let result = text;
    for (const m of metrics) {
      const val = m.value || '';
      // Replace \command{} (with braces)
      result = result.split('\\' + m.command + '{}').join(val);
      // Replace \command followed by non-alpha (e.g. \command\%, \command-meter)
      // Use a loop to handle all occurrences
      const prefix = '\\' + m.command;
      let i = 0;
      let out = '';
      while (i < result.length) {
        if (result.startsWith(prefix, i)) {
          const afterIdx = i + prefix.length;
          // Check if next char is a letter (which would mean it's a different command)
          if (afterIdx >= result.length || !/[a-zA-Z]/.test(result[afterIdx])) {
            out += val;
            i = afterIdx;
            continue;
          }
        }
        out += result[i];
        i++;
      }
      result = out;
    }
    return result;
  }

  // Replace in items
  for (const item of items) {
    const updated = replaceMetrics(item.content);
    if (updated !== item.content) {
      updateItem.run(updated, item.id);
    }
  }

  // Replace in entry fields (JSON)
  for (const entry of entries) {
    const original = entry.fields;
    const updated = replaceMetrics(original);
    if (updated !== original) {
      updateEntry.run(updated, entry.id);
    }
  }

  // Drop the metrics table and index
  db.exec('DROP TABLE IF EXISTS metrics');
  db.exec('DROP INDEX IF EXISTS idx_metrics_section');
};
