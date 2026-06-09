/**
 * Build the template context from a resolved variant (db.resolveVariant output).
 *
 * This is the ENGINE-AGNOSTIC data-prep layer and the documented, versioned
 * contract that every layout template consumes. It contains only data (plus a
 * few precomputed booleans) — never LaTeX strings. All LaTeX emission and
 * escaping happens in the templates (via the host `tex` filter).
 *
 * It centralises the prep that used to be scattered through generator.js:
 *   - photo:        photoEnabled/photoFile → { enabled, file } | null
 *   - socials:      SOCIAL_CATALOG-driven flattening into an ordered array
 *   - education:    program + major → position (the SECTION_TYPE_MAP combine)
 *   - paragraph:    first entry's `text`
 *   - style/spacing/fonts: merged with defaults; accent colour resolved to a
 *     {kind,value} decision (preset / custom hex / legacy hex / none)
 *
 * Bump CONTEXT_VERSION on any breaking change to this shape; a layout's
 * manifest declares the contextVersion it was authored against.
 */
const SOCIAL_CATALOG = require('../social-catalog');
const ACCENT_COLORS = require('../accent-colors');
const { getLatexType, SECTION_TYPE_MAP } = require('../latex-type-map');
const { STYLE_DEFAULTS, SPACING_DEFAULTS, FONT_DEFAULTS } = require('../style-defaults');

const CONTEXT_VERSION = 1;

const PRESET_COLOR_KEYS = ACCENT_COLORS.map((c) => c.key);

// ---------------------------------------------------------------------------
// personal
// ---------------------------------------------------------------------------

function buildPersonal(personalIn) {
  const p = Object.assign({}, personalIn);

  // Photo: DB stores photoEnabled ('1'/'0') + photoFile; templates want an object.
  const photo = p.photoEnabled === '1'
    ? { enabled: true, file: p.photoFile || 'profile' }
    : null;
  delete p.photoEnabled;
  delete p.photoFile;

  // Socials: flatten the catalog into an ordered list of { key, values:[...] }.
  // 2-arg socials emit both args (possibly empty) when EITHER is set; 1-arg
  // socials emit only when set — matching the legacy serializeData loop.
  const socials = [];
  for (const cat of SOCIAL_CATALOG) {
    if (cat.args === 2) {
      const v1 = p[cat.fields[0]];
      const v2 = p[cat.fields[1]];
      if (v1 || v2) socials.push({ key: cat.key, values: [v1 || '', v2 || ''] });
    } else if (p[cat.key]) {
      socials.push({ key: cat.key, values: [p[cat.key]] });
    }
  }

  return Object.assign({}, p, { photo, socials });
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

function buildSection(section) {
  const latexType = getLatexType(section.type);
  const out = { id: section.id, type: section.type, latexType, title: section.title };

  if (latexType === 'cvparagraph') {
    const first = section.entries && section.entries[0];
    out.text = first ? (first.fields.text || '') : '';
    return out;
  }

  out.entries = (section.entries || []).map((e) => {
    const fields = Object.assign({}, e.fields);
    // Combine rule (e.g. education: program + major → position).
    const typeInfo = SECTION_TYPE_MAP[section.type];
    if (typeInfo && typeInfo.combine) {
      const { target, from, join } = typeInfo.combine;
      fields[target] = from.map((k) => fields[k] || '').join(join).trim();
    }
    const entry = Object.assign({}, fields);
    // Only cventries render bullets; expose items as a plain string array.
    if (latexType === 'cventries') {
      entry.items = (e.items || []).map((i) => i.content);
    }
    return entry;
  });
  return out;
}

// ---------------------------------------------------------------------------
// style / spacing / fonts
// ---------------------------------------------------------------------------

// Accent resolution. `kind`/`value` drive awesome-cv's named-color commands;
// `hex` (6 hex digits, no #) is the resolved colour for layouts that don't have
// awesome-cv's palette (e.g. a stock-article layout using \definecolor).
function resolveAccent(style) {
  const accentColor = style.accentColor;
  if (PRESET_COLOR_KEYS.includes(accentColor)) {
    const c = ACCENT_COLORS.find((x) => x.key === accentColor);
    return { kind: 'preset', value: accentColor, hex: c.hex.replace(/^#/, '') };
  }
  if (accentColor === 'custom' && style.customHex) {
    const hex = String(style.customHex).replace(/^#/, '');
    return { kind: 'hex', value: hex, hex };
  }
  // Legacy: accentColor is itself a raw hex (or empty → no named color).
  const hex = String(accentColor || '').replace(/^#/, '');
  if (hex) return { kind: 'hex', value: hex, hex };
  return { kind: 'none', value: '', hex: '1F6FEB' }; // neutral fallback for non-awesome layouts
}

function buildStyle(styleIn) {
  const style = Object.assign({}, STYLE_DEFAULTS, styleIn);
  style.accent = resolveAccent(style);
  return style;
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

/**
 * @param {object} compileData - output of db.resolveVariant(id)
 * @param {object} [opts] - { layoutId } stamped into meta for templates/debugging
 * @returns {object} the documented template context
 */
function buildContext(compileData, opts = {}) {
  const { personal, sections, coverletter, variant, style, spacing, fonts } = compileData;
  return {
    meta: {
      kind: variant,
      layoutId: opts.layoutId || null,
      contextVersion: CONTEXT_VERSION,
    },
    personal: buildPersonal(personal || {}),
    sections: (sections || []).map(buildSection),
    coverletter: coverletter || null,
    style: buildStyle(style || {}),
    spacing: Object.assign({}, SPACING_DEFAULTS, spacing || {}),
    fonts: Object.assign({}, FONT_DEFAULTS, fonts || {}),
  };
}

module.exports = { buildContext, CONTEXT_VERSION };
