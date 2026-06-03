/**
 * Approximate tag matching — powers the tag-search endpoint and the author-time
 * variant-rule expansion. Pure, deterministic, dependency-free.
 *
 * IMPORTANT: fuzziness lives HERE (and in the /tags/search + /rules/expand
 * endpoints that call it) ONLY. Variant *resolution* stays exact — see
 * db._matchesTags. The contract is: approximate matching helps an author/LLM
 * find and reuse tags, but anything that lands in a rendered PDF must be a
 * concrete tag stored in a variant rule, never a fuzzy match evaluated at
 * render time. That keeps a person's resume reproducible and inspectable.
 *
 * A person's vocabulary is at most a few hundred tags, so the brute-force
 * O(V·|q|) scan below is sub-millisecond — no index, no SQLite extension.
 */

// Below this length, character trigrams are too noisy to be meaningful
// (e.g. "r", "go", "ml"), so we fall back to exact/prefix matching only.
const MIN_TRIGRAM_LEN = 4;

/** Boundary-padded character trigram set (padding weights prefixes/suffixes). */
function trigrams(s) {
  const padded = `  ${s} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Sørensen–Dice similarity over trigram sets, in [0, 1]. Symmetric. */
function diceCoefficient(a, b) {
  if (a === b) return 1;
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Score a normalized query against one normalized candidate tag.
 * Returns {score, via} (via ∈ exact|prefix|substring|trigram) or null for no match.
 * Containment (prefix/substring) is treated as a strong signal because it
 * captures morphological variants ("frontend" ⇢ "frontends") without typo noise.
 */
function scoreTag(query, tag) {
  if (query === tag) return { score: 1, via: 'exact' };

  const lenRatio = Math.min(query.length, tag.length) / Math.max(query.length, tag.length);
  const short = query.length < MIN_TRIGRAM_LEN || tag.length < MIN_TRIGRAM_LEN;

  if (tag.startsWith(query) || query.startsWith(tag)) {
    return { score: round(0.6 + 0.4 * lenRatio), via: 'prefix' };
  }
  // Short strings can't earn a trigram score — exact/prefix only, else nothing.
  if (short) return null;

  const dice = diceCoefficient(query, tag);
  if (tag.includes(query) || query.includes(tag)) {
    return { score: round(Math.max(dice, 0.5 + 0.3 * lenRatio)), via: 'substring' };
  }
  return dice > 0 ? { score: round(dice), via: 'trigram' } : null;
}

/**
 * Rank `vocab` (array of {tag, count}) against a normalized `query`.
 * Returns [{tag, score, count, via}] sorted by score desc, then count desc,
 * then tag asc — a total order, so results are fully deterministic. Filtered to
 * score >= minScore and capped at limit.
 */
function searchTags(query, vocab, { limit = 10, minScore = 0.3 } = {}) {
  const out = [];
  for (const { tag, count } of vocab) {
    const s = scoreTag(query, tag);
    if (s && s.score >= minScore) out.push({ tag, score: s.score, count: count || 0, via: s.via });
  }
  out.sort((a, b) => b.score - a.score || b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return limit > 0 ? out.slice(0, limit) : out;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { trigrams, diceCoefficient, scoreTag, searchTags, MIN_TRIGRAM_LEN };
