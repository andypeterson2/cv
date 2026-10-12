/**
 * Which ranking arm serves a tag-suggestion request.
 *
 * Kept apart from the route so the fallback can be tested directly: whether the
 * embedding module loads depends on an optional dependency, which a test that
 * boots the real server cannot take away.
 */
const { SCORER_METHODS } = require('@cv/constants');

/** The embedding arms, in the order an unpinned request prefers them. */
const EMBEDDING_ARMS = SCORER_METHODS.filter((m) => m !== 'lexical');

/**
 * Ask the deployment to choose. Not a scorer name: it never reaches a recorded
 * row, which is why it is kept out of SCORER_METHODS.
 */
const AUTO = 'auto';

/**
 * Choose an arm.
 *
 * Naming one gets it or nothing — the offline evaluation pins an arm, and a
 * silent substitution there would label its rows with a ranker that did not
 * produce them. Naming none stays lexical, which is the default the API has
 * always documented and the only one that needs no model. `auto` hands the
 * choice to the deployment, which is how the interactive client gets an arm
 * assigned where the data that measures it lives.
 *
 * @param {string|undefined} requested  the client's `scorer`, or `auto`
 * @param {string[]} available          arms this deployment can actually serve
 * @returns {string|null} the arm to use, or null when a pinned one is missing
 */
function pickScorer(requested, available) {
  if (requested === AUTO) return EMBEDDING_ARMS.find((m) => available.includes(m)) || 'lexical';
  if (!requested) return 'lexical';
  return available.includes(requested) ? requested : null;
}

module.exports = { pickScorer, EMBEDDING_ARMS, AUTO };
