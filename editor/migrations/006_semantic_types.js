const { LATEX_TYPE_MAP, LEGACY_TYPE_MAP, normalizeType } = require('../lib/latex-type-map');

// Known section id → semantic type mappings (beyond the default LEGACY_TYPE_MAP fallback)
const ID_TO_SEMANTIC = {
  experience: 'experience',
  education: 'education',
  projects: 'projects',
  presentations: 'presentations',
  leadership: 'leadership',
  volunteer: 'volunteer',
  committees: 'committees',
  extracurricular: 'extracurricular',
  writing: 'writing',
  skills: 'skills',
  honors: 'honors',
  certifications: 'certifications',
  summary: 'summary',
  references: 'references',
};

function guessSemantic(id, currentType) {
  // Already a semantic type — no change needed
  if (LATEX_TYPE_MAP[currentType]) return currentType;
  // Try id-based match first
  if (ID_TO_SEMANTIC[id]) return ID_TO_SEMANTIC[id];
  // Fall back to default semantic for this LaTeX type
  return LEGACY_TYPE_MAP[currentType] || currentType;
}

module.exports = function migrate(db) {
  // Migrate sections.type from LaTeX names to semantic names
  const sections = db.prepare('SELECT id, type FROM sections').all();
  const updateStmt = db.prepare('UPDATE sections SET type = ? WHERE id = ?');

  for (const sec of sections) {
    const newType = guessSemantic(sec.id, sec.type);
    if (newType !== sec.type) {
      updateStmt.run(newType, sec.id);
    }
  }

  // Migrate persons.data JSON blobs
  const persons = db.prepare('SELECT id, data FROM persons WHERE data IS NOT NULL').all();
  const updatePerson = db.prepare('UPDATE persons SET data = ? WHERE id = ?');

  for (const person of persons) {
    try {
      const data = JSON.parse(person.data);
      if (!data.sections) continue;
      let changed = false;
      for (const sec of data.sections) {
        const newType = guessSemantic(sec.id, sec.type);
        if (newType !== sec.type) {
          sec.type = newType;
          changed = true;
        }
      }
      if (changed) {
        updatePerson.run(JSON.stringify(data), person.id);
      }
    } catch (e) {
      console.warn('Migration 006: skipping malformed persons.data for id=' + person.id);
    }
  }
};
