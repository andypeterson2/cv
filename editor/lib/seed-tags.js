/**
 * The starter tag vocabulary: broad résumé categories plus ESCO skills. Suggestion
 * draws on it while a person's own vocabulary is small; a starter tag joins their
 * catalog the first time it is used.
 */
const data = require('./seed-tags.json');

const SEED_TAGS = data.tags;
const byTag = new Map(SEED_TAGS.map((t) => [t.tag, t]));

module.exports = {
  SEED_TAGS,
  SEED_ATTRIBUTION: data.attribution,
  seedTag: (tag) => byTag.get(tag),
};
