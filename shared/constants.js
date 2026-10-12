/**
 * Canonical constants shared by the cv editor (REST API, CommonJS) and the MCP
 * server (ESM), so a change (e.g. adding a variant kind or a scorer) lands in
 * one place and both validation surfaces stay in agreement.
 *
 * CommonJS on purpose: the editor `require()`s it directly and the ESM MCP
 * server imports it via the Node CJS-interop default import.
 */

// Variant render kinds. `cv` = the full main; `resume`/`coverletter` are shaped.
const VARIANT_KINDS = ['cv', 'resume', 'coverletter'];

// Section slug shape (kebab/underscore, lowercase) — unique per profile.
const SLUG_PATTERN = '^[a-z0-9_-]+$';

// Tag-suggestion ranking methods. `lexical` needs no model; `embedding` and
// `embedding-ft` are the optional local semantic scorers, stock and fine-tuned.
// Each names a serving configuration, blend weight and K included, and lands in
// tag_events, so the names stay fixed once used.
const SCORER_METHODS = ['lexical', 'embedding', 'embedding-ft'];

module.exports = { VARIANT_KINDS, SLUG_PATTERN, SCORER_METHODS };
