/**
 * Pure cosine-similarity ranking. Dependency-free so it's unit-testable without
 * loading any embedding model. Used by lib/embed-scorer.js (the optional Phase-B
 * semantic scorer); kept separate precisely so tests can exercise the ranking
 * math with fixed fixtures.
 */

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosineSim(a, b) {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  if (!na || !nb) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * Rank candidates by cosine similarity to queryVec.
 * @param {number[]} queryVec
 * @param {Array<{tag, vec}>} candidates
 * @returns {Array<{tag, score}>} sorted score desc, then tag asc (deterministic)
 */
function cosineRank(queryVec, candidates) {
  const out = candidates.map((c) => ({ tag: c.tag, score: round(cosineSim(queryVec, c.vec)) }));
  out.sort((a, b) => b.score - a.score || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return out;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { cosineSim, cosineRank };
