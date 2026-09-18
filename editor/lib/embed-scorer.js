/**
 * OPTIONAL local embedding scorer for tag suggestion — an alternate ranker that
 * plugs into db.suggestTags' `scorer` seam. Pure-Node, no Python: uses
 * @huggingface/transformers (v3, the maintained successor of @xenova/transformers)
 * running all-MiniLM-L6-v2 (~23 MB quantized ONNX). Catches conceptual matches the lexical
 * scorer misses (e.g. "orchestrated containers" → `kubernetes`).
 *
 * Design guarantees:
 *  - LAZY: the model loads on first scorer() call, never at require time, so the
 *    default lexical path never pays for it.
 *  - GRACEFUL ABSENCE: if @huggingface/transformers isn't installed, requiring this
 *    module throws (the require.resolve below), and the suggest route turns
 *    that into a clean 501 — the lexical path is unaffected.
 *  - SUGGEST-not-APPLY: returns candidates only; never writes a tag, never
 *    touches variant resolution.
 */

require.resolve('@huggingface/transformers'); // throws if the optional dep is absent → 501 upstream
const { cosineRank } = require('./cosine');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
// Node defaults to fp32; q8 is the quantized file the Docker build bakes in.
const DTYPE = 'q8';
let _pipePromise = null;
const _cache = new Map(); // text → number[] embedding (per-process; vocab is tiny)

function getPipe() {
  if (!_pipePromise) {
    _pipePromise = (async () => {
      const { pipeline, env } = require('@huggingface/transformers');
      // Where the model is pre-baked (Docker sets CV_EMBED_OFFLINE=1), never hit the
      // HF CDN at runtime; unset on host dev so a fresh checkout can download it.
      if (process.env.CV_EMBED_OFFLINE === '1') env.allowRemoteModels = false;
      return pipeline('feature-extraction', MODEL, { dtype: DTYPE });
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
 * scorer(text, candidates) — the shape db.suggestTags expects.
 * Embeds the input + each candidate (cached), ranks by cosine. The caller then
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

/** Embed candidates ahead of time, so the first suggestion does not pay for them. */
async function warm(candidates) {
  for (const c of candidates) await embed(candidateText(c));
}

module.exports = { scorer, embed, warm, candidateText, MODEL, _cache };
