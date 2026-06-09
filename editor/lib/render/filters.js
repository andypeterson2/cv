/**
 * Host-provided Nunjucks filters, available to every layout template.
 *
 * Escaping is deliberately NOT autoescaped (Nunjucks autoescape is HTML-only).
 * Templates must call `| tex` on every user-supplied value; the verification
 * gate compiles a fixture full of LaTeX specials, so a layout that forgets to
 * escape fails the contract rather than silently producing broken output.
 */
const { sanitizeLatex } = require('./sanitize');

/**
 * `| tex` — escape a value for use in LaTeX text/argument position.
 * Identical to the legacy wired escaper. This is the one every layout needs.
 */
function tex(value) {
  return sanitizeLatex(value == null ? '' : String(value));
}

/**
 * `| texurl` — escape a value for use inside a URL argument (e.g. \href{...}).
 * `#` and `%` must be escaped or they break the URL; `~` and `_` are common in
 * URLs and are left intact (hyperref handles them in the URL catcode regime).
 */
function texurl(value) {
  if (value == null) return '';
  return String(value).replace(/([#%])/g, '\\$1');
}

/**
 * `| texargs` — turn an array of values into consecutive escaped LaTeX
 * arguments: ['inst','name'] → "{inst}{name}". Lets a template emit a
 * variable-arity command (e.g. a 1- or 2-arg social) on a single line,
 * without inline block tags that would disturb whitespace under trimBlocks.
 */
function texargs(values) {
  if (!Array.isArray(values)) return '';
  return values.map((v) => `{${tex(v)}}`).join('');
}

/**
 * Register all host filters onto a configured Nunjucks Environment.
 */
function registerFilters(env) {
  env.addFilter('tex', tex);
  env.addFilter('texurl', texurl);
  env.addFilter('texargs', texargs);
  return env;
}

module.exports = { registerFilters, tex, texurl, texargs };
