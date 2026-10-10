/**
 * PDF text-layer check: compares what a parser extracts from a compiled PDF
 * with the source text it was built from, so glyph-mapping faults (non-breaking
 * hyphens, mixed-case small caps, words split at line ends, labels injected by
 * ActualText, symbols the font cannot draw) fail verification instead of
 * reaching an applicant tracking system.
 *
 * extractText() shells out to poppler's pdftotext; it resolves null when the
 * binary is absent so callers can report the check as skipped.
 */
const { execFile } = require('child_process');
const { clean } = require('../linkedin');
const { SYMBOLS } = require('../symbols');

// Characters a layout adds on its own: bullets, separators, quotes, dashes.
const LAYOUT_CHARS = new Set([...'•|·“”‘’"\'–—…,.:;()/[]+-@&%$#!?*']);

// Characters that only ever come from a broken glyph-to-text mapping.
const SUSPECT_CHARS = /[‑­ıſ�-]/u;

// Words layouts print on their own: the letter date, "Cover Letter", "Position in Place".
const LAYOUT_WORDS = new Set(
  'january february march april may june july august september october november december cover letter page in attached'.split(
    ' ',
  ),
);

const GLYPH_BY_CMD = new Map(SYMBOLS.map((s) => [s.cmd.slice(1), s.glyph]));

function extractText(pdfPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'pdftotext',
      ['-enc', 'UTF-8', pdfPath, '-'],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && err.code === 'ENOENT') return resolve(null);
        if (err) return reject(err);
        resolve(stdout);
      },
    );
  });
}

/** Stored field text → the plain text a reader should get back from the PDF. */
function plain(s) {
  const withGlyphs = String(s ?? '').replace(/\\([a-zA-Z]+)(?![a-zA-Z])\s*(\{\})?/g, (m, name) =>
    GLYPH_BY_CMD.has(name) ? GLYPH_BY_CMD.get(name) : m,
  );
  return clean(withGlyphs).normalize('NFKC');
}

function words(s) {
  return s.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
}

function sectionStrings(sections) {
  const out = [];
  for (const sec of sections || []) {
    out.push(sec.title, ...(sec.texts || []));
    for (const e of sec.entries || []) {
      for (const [k, v] of Object.entries(e)) out.push(...(k === 'items' ? v : [v]));
    }
  }
  return out;
}

/**
 * Source strings of a buildContext() result, split into `body` (text every
 * layout must print) and `extra` (header fields a layout may leave out).
 */
function sourceStrings(ctx) {
  const p = ctx.personal || {};
  const body = [p.firstName, p.lastName, ...sectionStrings(ctx.sections)];
  const extra = ['position', 'address', 'mobile', 'email', 'dateofbirth', 'quote', 'extrainfo'].map(
    (k) => p[k],
  );
  for (const soc of p.socials || []) extra.push(...soc.values, soc.link);

  const c = ctx.meta && ctx.meta.kind === 'coverletter' ? ctx.coverletter : null;
  if (c) {
    body.push(c.recipientName, c.recipientAddress, c.title, c.opening, c.closing);
    for (const s of c.sections || []) body.push(s.title, s.body);
    extra.push(c.enclosureLabel, c.enclosureContent);
  }

  const keep = (xs) => xs.filter((x) => typeof x === 'string' && x.trim() !== '').map(plain);
  return { body: keep(body), extra: keep(extra) };
}

function codePoint(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${ch}`;
}

// NFKC would fold U+2011 into U+2010, so this rule reads the text unfolded.
function foreignChars(raw, src) {
  const out = [];
  for (const ch of new Set(raw.normalize('NFC'))) {
    if (/\s/u.test(ch) || src.chars.has(ch)) continue;
    const suspect = SUSPECT_CHARS.test(ch);
    if (!suspect && /\p{L}/u.test(ch)) continue; // letters are judged by the word rules
    if (suspect || !(LAYOUT_CHARS.has(ch) || /\p{N}/u.test(ch)))
      out.push(['foreign-char', codePoint(ch)]);
  }
  return out;
}

function lineSplits(text, src) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(/(\p{L}+)[-‐‑­]\s*$/u);
    const n = lines[i + 1].match(/^\s*(\p{L}+)/u);
    if (m && n && src.lower.has((m[1] + n[1]).toLowerCase()))
      out.push(['line-split', `${m[1]}-/${n[1]}`]);
  }
  return out;
}

function isMixedCase(w) {
  return /\p{Ll}/u.test(w.slice(1)) && /\p{Lu}{2}/u.test(w);
}

function foreignWords(text, src) {
  const out = [];
  for (const w of words(text)) {
    const lw = w.toLowerCase();
    if (src.words.has(w)) continue;
    if (isMixedCase(w)) out.push(['mixed-case', w]);
    else if (src.lower.has(lw) || /^\p{N}+$/u.test(w) || LAYOUT_WORDS.has(lw)) continue;
    else out.push(['foreign-word', w]);
  }
  return out;
}

function missingWords(text, body) {
  const seen = new Set(words(text).map((w) => w.toLowerCase()));
  return words(body.join('\n'))
    .filter((w) => !seen.has(w.toLowerCase()))
    .map((w) => ['missing-word', w]);
}

/**
 * @param {object} ctx  buildContext() output the PDF was rendered from
 * @param {string} text pdftotext output
 * @returns {{ok: boolean, issues: {rule: string, sample: string}[]}}
 */
function checkText(ctx, text) {
  const { body, extra } = sourceStrings(ctx);
  const source = [...body, ...extra].join('\n');
  const sourceWords = new Set(words(source));
  const src = {
    chars: new Set(source),
    words: sourceWords,
    lower: new Set([...sourceWords].map((w) => w.toLowerCase())),
  };
  const folded = text.normalize('NFKC');
  const found = [
    ...foreignChars(text, src),
    ...lineSplits(folded, src),
    ...foreignWords(folded, src),
    ...missingWords(folded, body),
  ];
  const seen = new Set();
  const issues = [];
  for (const [rule, sample] of found) {
    const key = `${rule}\u0000${sample}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ rule, sample });
    }
  }
  return { ok: issues.length === 0, issues };
}

module.exports = { extractText, checkText, sourceStrings, plain };
