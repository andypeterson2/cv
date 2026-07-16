/**
 * LinkedIn / Indeed / Handshake export — a pure, downstream consumer of a resolved
 * variant (see db.resolveVariant). None of those sites expose an individual write
 * API, so the CV stays the source of truth and this produces paste-ready work-history
 * blocks plus a per-entry fingerprint. The fingerprint is the point: it lets
 * cv_linkedin_status say exactly which positions have drifted since you last pasted
 * (see db/linkedin.js), so mirroring edits by hand is never guesswork.
 *
 * No DB or network here — feed it resolved JSON, get blocks back. Kept pure so the
 * fragile bits (LaTeX cleanup, date parsing) are unit-testable against real data.
 */
const { createHash } = require('crypto');

// Position-description character limits. LinkedIn silently truncates at ~2000, so
// we surface `overLimit` rather than let a paste lose its tail.
const LIMITS = { description: 2000, headline: 220, about: 2600 };

// Bullet glyph per consumer: LinkedIn renders "•", Indeed/Handshake textareas want
// none, markdown wants "-". One exporter, three presentations — the fingerprint is
// computed glyph-free so switching format never reads as drift.
const BULLETS = { linkedin: '• ', plaintext: '', markdown: '- ' };

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Strip stored XeLaTeX source down to plain text a form field can take: unescape
 * LaTeX specials, turn `\textrightarrow{}` into an arrow, drop any other control
 * word, normalise `--`/`---` dashes and `~`, then collapse the whitespace that
 * removals leave behind.
 */
function clean(s) {
  return String(s ?? '')
    .replace(/\\([&%$#_{}])/g, '$1')            // \& \% \$ \# \_ \{ \} → literal
    .replace(/\\textrightarrow\s*\{\}/g, ' → ') // the one arrow macro in the data
    .replace(/\\[a-zA-Z]+\s*\{\}/g, '')         // any other empty-argument control word
    .replace(/\\[a-zA-Z]+/g, '')                // …and any bare control word
    .replace(/---/g, '—')                       // LaTeX em-dash
    .replace(/--/g, '–')                        // LaTeX en-dash
    .replace(/~/g, ' ')                         // non-breaking space
    .replace(/\\\\/g, ' ')                       // explicit line break
    .replace(/\s+/g, ' ')                        // collapse the gaps removals opened
    .trim();
}

/**
 * Parse a date field into LinkedIn's start/end month-year. Real data is
 * `"July 2022 -- December 2024"` (full month names, LaTeX `--`) but this also takes
 * en/em dashes, year-only ranges, and "Present"/"Current" (→ end: null, i.e. "I
 * currently work here"). A lone date is treated as an open-ended start.
 * `month` is null when the source gives only a year — the pasting user picks one.
 */
function parseRange(raw) {
  const parts = clean(raw).split(/\s*(?:–|—|-)\s*/); // clean() already made -- / --- into – / —
  const one = (t) => {
    const v = (t || '').trim();
    if (!v || /present|current|now|ongoing/i.test(v)) return null;
    const m = v.match(/([A-Za-z]+)?\s*(\d{4})/); // "July 2022" | "2022"
    if (!m) return null;
    return { month: m[1] ? (MONTHS[m[1].slice(0, 3).toLowerCase()] ?? null) : null, year: Number(m[2]) };
  };
  return { start: one(parts[0]), end: parts.length > 1 ? one(parts[1]) : null };
}

/**
 * Turn a resolved variant into work-history blocks. NOTE the field mapping, verified
 * against real data (Step 0): the role is `fields.position` and the organisation is
 * `fields.organization` — NOT `fields.title` (experience entries carry no `title`).
 */
function exportLinkedin(resolved, format = 'linkedin') {
  const bullet = BULLETS[format] ?? BULLETS.linkedin;
  const exp = (resolved.sections || []).find((s) => s.type === 'experience');
  const positions = (exp ? exp.entries : []).map((e) => {
    const f = e.fields || {};
    const bullets = (e.items || []).map((i) => clean(i.content)).filter(Boolean);
    const description = bullets.map((b) => bullet + b).join('\n');
    const { start, end } = parseRange(f.date || '');
    const pos = {
      entryId: e.id,
      title: clean(f.position),
      company: clean(f.organization),
      location: clean(f.location || ''),
      start,
      end,
      description,
      overLimit: description.length > LIMITS.description,
    };
    // Fingerprint over normalised, glyph-free values — a cosmetic LaTeX-escaping or
    // format change must not read as drift; a real content change must.
    pos.fingerprint = createHash('sha256')
      .update(JSON.stringify([pos.title, pos.company, pos.location, start, end, bullets.join('\n')]))
      .digest('hex');
    return pos;
  });
  return { format, limits: LIMITS, positions };
}

module.exports = { exportLinkedin, clean, parseRange, LIMITS, BULLETS };
