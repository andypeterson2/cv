/**
 * LaTeX escaping — host-owned, shared by every layout.
 *
 * This is security- and contract-critical, so it lives in the render host (not
 * in any uploaded layout bundle) and is exposed to templates as the `tex`
 * filter (see ./filters.js). It MUST stay byte-for-byte identical to the
 * escaper that lib/serializer.js `sanitizeLatex` wired into the legacy
 * generator, or the builtin layout's golden-equivalence test breaks.
 *
 * Behaviour (matched to the legacy wired path):
 *   - escapes the bare specials  # $ % & _ ^  by backslash-prefixing them
 *   - skips a special that is already escaped (preceded by a backslash), so
 *     intentional commands like \textbf{...} or a hand-written \& survive
 *   - does NOT touch ~ or \ (the legacy wired path didn't either) — the
 *     verification fixture deliberately includes ~ and \ so the contract gate
 *     surfaces any uploaded layout that needs stronger escaping
 *   - non-strings / empty → '' (so templates can pass through missing fields)
 */
function sanitizeLatex(text) {
  if (typeof text !== 'string' || text === '') return text || '';
  return text.replace(/(?<!\\)([#$%&_^])/g, '\\$1');
}

module.exports = { sanitizeLatex };
