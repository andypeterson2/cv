/**
 * Host-provided Nunjucks filters, available to every layout template.
 *
 * Escaping is deliberately not autoescaped (Nunjucks autoescape is HTML-only).
 * Templates must call `| tex` on every user-supplied value; the verification
 * gate compiles a fixture full of LaTeX specials, so a layout that forgets to
 * escape fails the contract rather than silently producing broken output.
 */
const { sanitizeLatex } = require('./sanitize');
const { SYMBOLS } = require('../symbols');

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
 * `<< symbolFallback() >>` — preamble block that keeps every palette symbol
 * visible: a symbol the current font lacks is set in DejaVu Sans instead, one
 * character at a time. Emit it after the main font is chosen.
 */
// unicode-math makes the big operators math-active and redefines them at
// \begin{document}; an active text definition for them breaks text mode, so
// they are mapped only when unicode-math is absent.
const MATH_ACTIVE = new Set(['∑', '∏', '∫']);

function fallbackLine(g) {
  const hex = g.codePointAt(0).toString(16).toUpperCase();
  return `\\newunicodechar{${g}}{\\iffontchar\\font"${hex} \\char"${hex} \\else{\\cvsymfallback\\char"${hex}}\\fi}`;
}

/**
 * `<< symbolFallback() >>` — preamble block that keeps every palette symbol
 * visible: a symbol the current font lacks is set in DejaVu Sans instead, one
 * character at a time. Emit it after the main font and unicode-math are loaded.
 */
function symbolFallback() {
  const glyphs = [...new Set(SYMBOLS.map((s) => s.glyph))].filter((g) => g.codePointAt(0) > 0x7f);
  return [
    '\\RequirePackage{newunicodechar}',
    '\\IfFontExistsTF{DejaVu Sans}',
    '  {\\newfontfamily\\cvsymfallback{DejaVu Sans}}',
    '  {\\newfontfamily\\cvsymfallback{DejaVuSans}[Extension=.ttf, BoldFont=*-Bold, ItalicFont=*-Oblique, BoldItalicFont=*-BoldOblique]}',
    ...glyphs.filter((g) => !MATH_ACTIVE.has(g)).map(fallbackLine),
    '\\makeatletter',
    '\\@ifpackageloaded{unicode-math}{}{%',
    ...glyphs.filter((g) => MATH_ACTIVE.has(g)).map((g) => `  ${fallbackLine(g)}%`),
    '}',
    '\\makeatother',
  ].join('\n');
}

/**
 * Register all host filters onto a configured Nunjucks Environment.
 */
function registerFilters(env) {
  env.addFilter('tex', tex);
  env.addFilter('texurl', texurl);
  env.addFilter('texargs', texargs);
  env.addGlobal('symbolFallback', symbolFallback);
  return env;
}

module.exports = { registerFilters, tex, texurl, texargs, symbolFallback };
