/**
 * Pure row/shape/text helpers for the SQLite access layer. Extracted from db.js
 * (no `this`, no SQL) so the data layer can be split into focused method modules
 * (see db/settings.js, and the documented follow-up for tags/variants/import)
 * that all share one helper source.
 */

function rowsToSettings(rows) {
  const out = {};
  for (const row of rows) {
    out[row.key] = (row.value_num != null && row.value_unit != null)
      ? { num: row.value_num, unit: row.value_unit }
      : row.value;
  }
  return out;
}

function stripPrefix(obj, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.startsWith(prefix) ? k.slice(prefix.length) : k] = v;
  return out;
}

/** Re-join {num,unit} setting objects into combined strings for the generator. */
function combineUnits(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = (v && typeof v === 'object' && 'num' in v) ? String(v.num) + v.unit : v;
  }
  return out;
}

function rowToSection(s) {
  return { id: s.id, personId: s.person_id, slug: s.slug, type: s.type, title: s.title, sortOrder: s.sort_order };
}

function rowToVariant(v) {
  return { id: v.id, personId: v.person_id, name: v.name, kind: v.kind, created_at: v.created_at, layoutId: v.layout_id ?? null };
}

function mapDocToVariantSections(docRows, sectionIdBySlug) {
  const out = [];
  for (const d of docRows) {
    const sectionId = sectionIdBySlug[d.sectionId];
    if (sectionId == null) continue;
    out.push({ sectionId, enabled: d.enabled !== false, sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : out.length });
  }
  return out;
}

/**
 * Canonicalize a tag for storage and exact matching. Conservative on purpose:
 * case, unicode accents, and separator STYLE (whitespace/underscore → hyphen)
 * are folded so "Front End", "front_end", and "front-end" converge — but
 * distinct words are never stemmed or merged ("java" ≠ "javascript"). Anything
 * looser (typos, true synonyms) is handled by fuzzy search + the alias map, not
 * here. Mirrored by the frozen snapshot in migrations/008_fuzzy_tags.js.
 */
function normTag(t) {
  return String(t)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // unify whitespace / underscores → hyphen
    .replace(/-+/g, '-') // collapse repeated hyphens
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

/** Flatten an entry's string field values into one text blob for suggestion. */
function entryText(fields) {
  return Object.values(fields || {}).filter((v) => typeof v === 'string').join(' ').trim();
}

/** Lexicographic ordering key: [effective sort, main sort, id]. */
function sortKey(override, main, id) {
  return [override != null ? override : main, main, id];
}

function bySort(a, b) {
  for (let i = 0; i < a._sort.length; i++) {
    if (a._sort[i] !== b._sort[i]) return a._sort[i] - b._sort[i];
  }
  return 0;
}

module.exports = {
  rowsToSettings,
  stripPrefix,
  combineUnits,
  rowToSection,
  rowToVariant,
  mapDocToVariantSections,
  normTag,
  entryText,
  sortKey,
  bySort,
};
