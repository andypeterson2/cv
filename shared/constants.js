/**
 * Canonical constants shared by the cv editor (REST API, CommonJS) and the MCP
 * server (ESM). These were duplicated as literals in both `editor/lib/schema.js`
 * and `mcp-worker/src/tools.ts`; keeping them here means a change (e.g. adding a
 * variant kind or a scorer) lands in one place instead of drifting between the
 * two validation surfaces.
 *
 * CommonJS on purpose: the editor `require()`s it directly and the ESM MCP
 * server imports it via the Node CJS-interop default import.
 */

// Variant render kinds. `cv` = the full master; `resume`/`coverletter` are shaped.
const VARIANT_KINDS = ['cv', 'resume', 'coverletter'];

// Section slug shape (kebab/underscore, lowercase) — unique per person.
const SLUG_PATTERN = '^[a-z0-9_-]+$';

// Tag-suggestion ranking methods. `lexical` needs no model; `embedding` is the
// optional local semantic scorer.
const SCORER_METHODS = ['lexical', 'embedding'];

module.exports = { VARIANT_KINDS, SLUG_PATTERN, SCORER_METHODS };
