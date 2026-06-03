#!/usr/bin/env node
/**
 * Build-time model prefetch.
 *
 * Downloads the quantized all-MiniLM ONNX + tokenizer into
 * node_modules/@xenova/transformers/.cache so the embedding scorer needs NO
 * network at runtime — the key to a host-ambiguous / offline-capable deploy.
 *
 * Run in the Docker `deps` stage AFTER `npm ci` (which wipes node_modules, so the
 * model must be re-fetched here). The cache lives inside node_modules and is
 * therefore carried into the deploy image by `COPY --from=deps node_modules`.
 * At runtime, embed-scorer.js (with CV_EMBED_OFFLINE=1) reads this baked cache.
 */
(async () => {
  const { pipeline, env } = require('@xenova/transformers');
  console.log('[prefetch-model] caching all-MiniLM-L6-v2 (quantized) into', env.cacheDir);
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); // quantized is the v2 default
  console.log('[prefetch-model] done');
})().catch((e) => {
  console.error('[prefetch-model] FAILED:', e.message);
  process.exit(1);
});
