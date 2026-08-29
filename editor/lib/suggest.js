/**
 * Tag suggestion — maps a piece of free text (a bullet/entry) to ranked
 * candidate tags drawn from a target vocabulary. Powers the /tags/suggest
 * endpoint and the cv_suggest_tags MCP tool.
 *
 * IMPORTANT — same invariant as lib/fuzzy.js: this is DISCOVERY/AUTHORING only.
 * It returns CANDIDATES; it never writes a tag and never invents one outside
 * the supplied vocabulary. Whatever an author/LLM then chooses is written
 * through db.addEntryTags/addItemTags → normTag + alias fold, and variant
 * resolution stays exact. So suggestion can be approximate (and even swap in a
 * semantic scorer) without ever affecting what a rendered PDF contains.
 *
 * The default scorer is purely lexical and reuses fuzzy.scoreTag — no new
 * matching math, no dependencies. An alternate `scorer` (e.g. embeddings) can
 * be injected without changing this module's shape or the endpoint.
 */

const fuzzy = require('./fuzzy');

// Function words only — kept deliberately small. We prune these so they don't
// generate junk bigrams ("the-react") or match short tags; we do NOT prune
// content verbs ("built", "designed") because they simply score low and the
// minScore filter handles them, whereas over-pruning hurts recall.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'by',
  'at',
  'from',
  'as',
  'is',
  'was',
  'were',
  'be',
  'been',
  'being',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'into',
  'than',
  'then',
  'but',
  'not',
  'via',
  'per',
  'across',
  'our',
  'their',
  'using',
]);

/**
 * Content words + adjacent bigrams (joined by '-', so "machine learning" can
 * hit the tag `machine-learning`). Bigrams are formed from the raw token
 * sequence but skipped when either side is a stopword.
 */
function tokenize(text) {
  const raw = String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const unigrams = raw.filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    if (a.length < 2 || b.length < 2 || STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    bigrams.push(`${a}-${b}`);
  }
  return [...new Set([...unigrams, ...bigrams])];
}

/** Best fuzzy.scoreTag over all tokens — a tag scores as well as its best-matching word. */
function lexicalScore(tokens, tag) {
  let best = null;
  for (const tok of tokens) {
    const s = fuzzy.scoreTag(tok, tag);
    if (s && (!best || s.score > best.score)) best = s;
  }
  return best; // {score, via} | null
}

const CATALOG_BOOST = 0.05; // soft steer toward the controlled vocabulary

/**
 * Rank `candidates` against `text`.
 * @param {string} text
 * @param {Array<{tag, count?, inCatalog?, description?}>} candidates  (unique tags)
 * @param {{limit?, minScore?, scorer?}} opts
 *        scorer: optional async (text, candidates) => [{tag, score}] (Phase-B seam)
 * @returns {Promise<Array<{tag, score, inCatalog, count, via}>>} deterministic order
 */
async function suggestTags(text, candidates, { limit = 8, minScore = 0.35, scorer } = {}) {
  if (!text || !String(text).trim() || !candidates || !candidates.length) return [];

  let scored;
  if (typeof scorer === 'function') {
    // Alternate (e.g. embedding) scorer returns [{tag, score}]; re-attach metadata.
    const meta = new Map(candidates.map((c) => [c.tag, c]));
    const ext = (await scorer(text, candidates)) || [];
    scored = ext
      .filter((r) => meta.has(r.tag))
      .map((r) => {
        const c = meta.get(r.tag);
        return {
          tag: r.tag,
          score: round(r.score),
          inCatalog: !!c.inCatalog,
          count: c.count || 0,
          via: 'embedding',
        };
      });
  } else {
    const tokens = tokenize(text);
    scored = [];
    for (const c of candidates) {
      const s = lexicalScore(tokens, c.tag);
      if (!s) continue;
      const boost = c.inCatalog ? CATALOG_BOOST : 0;
      scored.push({
        tag: c.tag,
        score: round(Math.min(1, s.score + boost)),
        inCatalog: !!c.inCatalog,
        count: c.count || 0,
        via: s.via,
      });
    }
  }

  const out = scored.filter((r) => r.score >= minScore);
  // Total order → deterministic: score desc, catalog first, count desc, tag asc.
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (b.inCatalog === a.inCatalog ? 0 : b.inCatalog ? 1 : -1) ||
      b.count - a.count ||
      (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
  );
  return limit > 0 ? out.slice(0, limit) : out;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { suggestTags, tokenize, STOPWORDS, CATALOG_BOOST };
