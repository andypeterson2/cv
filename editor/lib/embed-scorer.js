/**
 * OPTIONAL local embedding scorer for tag suggestion — an alternate ranker that
 * plugs into db.suggestTags' `scorer` seam (see lib/suggest.js). Pure-Node, NO
 * Python: uses @xenova/transformers (transformers.js) running all-MiniLM-L6-v2
 * (~80 MB ONNX). Catches conceptual matches the lexical scorer misses (e.g.
 * "orchestrated containers" → `kubernetes`).
 *
 * Design guarantees:
 *  - LAZY: the model loads on first scorer() call, never at require time, so the
 *    default lexical path never pays for it.
 *  - GRACEFUL ABSENCE: if @xenova/transformers isn't installed, requiring this
 *    module throws (the require.resolve below), and routes/persons.js
 *    resolveScorer turns that into a clean 501 — the lexical path is unaffected.
 *  - SUGGEST-NOT-APPLY: returns candidates only; never writes a tag, never
 *    touches variant resolution.
 */

require.resolve('@xenova/transformers'); // throws if the optional dep is absent → 501 upstream
const { cosineRank } = require('./cosine');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let _pipePromise = null;
const _cache = new Map(); // text → number[] embedding (per-process; vocab is tiny)

function getPipe() {
  if (!_pipePromise) {
    _pipePromise = (async () => {
      const { pipeline, env } = require('@xenova/transformers');
      // Offline guarantee for baked-model deploys: never reach out to the HF CDN
      // at runtime. Set CV_EMBED_OFFLINE=1 where the model is pre-baked (the
      // Docker dev/deploy stages). Left unset on host dev so a fresh checkout can
      // still download the model on first use.
      if (process.env.CV_EMBED_OFFLINE === '1') env.allowRemoteModels = false;
      return pipeline('feature-extraction', MODEL);
    })();
  }
  return _pipePromise;
}

async function embed(text) {
  if (_cache.has(text)) return _cache.get(text);
  const pipe = await getPipe();
  const out = await pipe(text, { pooling: 'mean', normalize: true });
  const vec = Array.from(out.data);
  _cache.set(text, vec);
  return vec;
}

// A tag's description is extra signal; fold it into the embedded text.
function candidateText(c) {
  return c.description ? `${c.tag}. ${c.description}` : c.tag;
}

/**
 * scorer(text, candidates) — the shape db.suggestTags/suggest.js expects.
 * Embeds the input + each candidate (cached), ranks by cosine. suggest.js then
 * re-applies the catalog-first tie-break and minScore filter, and tags via:'embedding'.
 * @returns {Promise<Array<{tag, score}>>}
 */
async function scorer(text, candidates) {
  const queryVec = await embed(text);
  const withVecs = [];
  for (const c of candidates) {
    withVecs.push({ tag: c.tag, vec: await embed(candidateText(c)) });
  }
  return cosineRank(queryVec, withVecs);
}

module.exports = { scorer, embed, MODEL, _cache };
