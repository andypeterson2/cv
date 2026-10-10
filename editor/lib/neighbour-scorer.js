/**
 * Blend a tag scorer with votes from the profile's own tagged bullets.
 *
 * The text is embedded, its K most similar tagged bullets vote for their tags
 * (each vote weighted by similarity), and a tag's score becomes
 * ALPHA · base score + (1 − ALPHA) · its share of the vote. A profile's own
 * habits ("qkd", "qi-lab") then carry to new bullets after a few uses, with no
 * training. Below MIN_EXAMPLES tagged bullets the base scorer runs unchanged.
 *
 * ALPHA, K and MIN_EXAMPLES are what serving uses; a caller sweeping them must
 * pass its own, so a measurement states the values it scored.
 */

const { cosineSim } = require('./cosine');

const ALPHA = 0.6;
const K = 8;
const MIN_EXAMPLES = 3;

/**
 * @param {Function} base - async (text, candidates) => [{tag, score}]
 * @param {Function} embed - async (text) => number[]
 * @param {Array<{text: string, tags: string[]}>} examples - the profile's tagged bullets
 * @param {{alpha?: number, k?: number, minExamples?: number}} [opts] - the serving
 *        constants when omitted; a parameter sweep passes its own.
 * @returns {Function} a scorer with the same signature as `base`
 */
function withNeighbours(base, embed, examples, opts = {}) {
  const alpha = opts.alpha ?? ALPHA;
  const k = opts.k ?? K;
  const minExamples = opts.minExamples ?? MIN_EXAMPLES;
  return async (text, candidates) => {
    const scored = await base(text, candidates);
    // A bullet being re-tagged must not vote for its own current tags.
    const pool = examples.filter((ex) => ex.text !== text && ex.tags.length > 0);
    if (pool.length < minExamples) return scored;

    const query = await embed(text);
    const sims = [];
    for (const ex of pool)
      sims.push({ tags: ex.tags, sim: cosineSim(query, await embed(ex.text)) });
    const nearest = sims.sort((a, b) => b.sim - a.sim).slice(0, k);
    const weight = nearest.reduce((sum, n) => sum + Math.max(n.sim, 0), 0);
    const votes = new Map();
    if (weight > 0) {
      for (const n of nearest) {
        for (const tag of n.tags)
          votes.set(tag, (votes.get(tag) || 0) + Math.max(n.sim, 0) / weight);
      }
    }
    return scored.map(({ tag, score }) => ({
      tag,
      score: alpha * score + (1 - alpha) * (votes.get(tag) || 0),
    }));
  };
}

module.exports = { withNeighbours, ALPHA, K, MIN_EXAMPLES };
