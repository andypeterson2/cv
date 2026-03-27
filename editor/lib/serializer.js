/**
 * JSON → LaTeX serializers for all section types in the awesome-cv project.
 * Reproduces the project's formatting conventions.
 */

const SEP = '%---------------------------------------------------------';
const FULL_SEP = '%-------------------------------------------------------------------------------';

// ---------------------------------------------------------------------------
// LaTeX sanitization — escape special chars that would break xelatex
// ---------------------------------------------------------------------------

/**
 * Escape bare LaTeX special characters in user-supplied text.
 * Characters: # $ % & _ ^
 * Skips characters that are already escaped (preceded by \).
 * Preserves intentional LaTeX commands like \enskip, \textbf{...}, etc.
 */
function sanitizeLatex(text) {
  if (typeof text !== 'string' || text === '') return text || '';
  // Escape bare special chars not preceded by backslash
  return text.replace(/(?<!\\)([#$%&_^])/g, '\\$1');
}

/** Shorthand for sanitizeLatex */
const san = sanitizeLatex;

// ---------------------------------------------------------------------------
// cventries (experience, education, extracurricular)
// ---------------------------------------------------------------------------

function serializeCventries(data) {
  const lines = [];
  lines.push(FULL_SEP);
  lines.push('% SECTION TITLE');
  lines.push(FULL_SEP);
  lines.push(`\\cvsection{${san(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('% CONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cventries}');
  lines.push('');

  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    lines.push(SEP);
    lines.push('  \\cventry');
    lines.push(`    {${san(e.position)}}`);
    lines.push(`    {${san(e.organization)}}`);
    lines.push(`    {${san(e.location)}}`);
    lines.push(`    {${san(e.date)}}`);

    if (e.items && e.items.length > 0) {
      lines.push('    {');
      lines.push('      \\begin{cvitems}');
      for (const item of e.items) {
        lines.push(`        \\item {${san(item)}}`);
      }
      lines.push('      \\end{cvitems}');
      lines.push('    }');
    } else {
      lines.push('    {}');
    }

    if (i < data.entries.length - 1) {
      lines.push('');
    }
  }

  lines.push('');
  lines.push(SEP);
  lines.push('\\end{cventries}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// cvskills
// ---------------------------------------------------------------------------

function serializeCvskills(data) {
  const lines = [];
  lines.push(SEP);
  lines.push('% SECTION TITLE');
  lines.push(SEP);
  lines.push('');
  lines.push(`\\cvsection{${san(data.title)}}`);
  lines.push('');
  lines.push(SEP);
  lines.push('% CONTENT');
  lines.push(SEP);
  lines.push('\\begin{cvskills}');
  lines.push('');

  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    lines.push(SEP);
    lines.push('  \\cvskill');
    lines.push(`    {${san(e.category)}}`);
    lines.push(`    {${san(e.skills)}}`);
    lines.push('');
  }

  lines.push(SEP);
  lines.push('');
  lines.push('\\end{cvskills}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// cvhonors (certifications, honors)
// ---------------------------------------------------------------------------

function serializeCvhonors(data) {
  const lines = [];
  lines.push(FULL_SEP);
  lines.push('%\tSECTION TITLE');
  lines.push(FULL_SEP);
  lines.push(`\\cvsection{${san(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('%\tCONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cvhonors}');
  lines.push('');

  for (const e of data.entries) {
    lines.push(SEP);
    lines.push('  \\cvhonor');
    lines.push(`    {${san(e.award)}} % Name`);
    lines.push(`    {${san(e.issuer)}} % Issuer`);
    lines.push(`    {${san(e.location)}} % Credential ID`);
    lines.push(`    {${san(e.date)}} % Date(s)`);
    lines.push('');
  }

  lines.push(SEP);
  lines.push('\\end{cvhonors}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// cvreferences
// ---------------------------------------------------------------------------

function serializeCvreferences(data) {
  const lines = [];
  lines.push(FULL_SEP);
  lines.push('%\tSECTION TITLE');
  lines.push(FULL_SEP);
  lines.push(`\\cvsection{${san(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('%\tCONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cvreferences}');

  for (const e of data.entries) {
    lines.push('  \\cvreference');
    lines.push(`    {${san(e.name)}}`);
    lines.push(`    {${san(e.relation)}}`);
    lines.push(`    {${san(e.phone)}}`);
    lines.push(`    {${san(e.email)}}`);
    lines.push('');
  }

  lines.push('\\end{cvreferences}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// cvparagraph (summary)
// ---------------------------------------------------------------------------

function serializeCvparagraph(data) {
  const lines = [];
  lines.push(FULL_SEP);
  lines.push('% SECTION TITLE');
  lines.push(FULL_SEP);
  lines.push(`\\cvsection{${san(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('% CONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cvparagraph}');
  lines.push('');
  lines.push(SEP);
  lines.push(san(data.text));
  lines.push('\\end{cvparagraph}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Auto-dispatch serializer
// ---------------------------------------------------------------------------

function serializeSection(data) {
  switch (data.type) {
    case 'cventries': return serializeCventries(data);
    case 'cvskills': return serializeCvskills(data);
    case 'cvhonors': return serializeCvhonors(data);
    case 'cvreferences': return serializeCvreferences(data);
    case 'cvparagraph': return serializeCvparagraph(data);
    default: throw new Error(`Unknown section type: ${data.type}`);
  }
}

// ---------------------------------------------------------------------------
// Document serializer (resume.tex / cv.tex) — rewrite \input lines
// ---------------------------------------------------------------------------

function serializeDocumentSections(tex, sections) {
  const lines = tex.split('\n');
  const result = [];
  let inSectionBlock = false;
  let sectionBlockDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isInputLine = /^\\input\{/.test(trimmed) || /^%\s*\\input\{/.test(trimmed);
    const isDataInput = /\\input\{data\.tex\}/.test(trimmed);
    const isBlankOrComment = trimmed === '' || (trimmed.startsWith('%') && !isInputLine);

    if (isInputLine && !isDataInput && !sectionBlockDone) {
      if (!inSectionBlock) {
        inSectionBlock = true;
        // Write all sections here
        for (const s of sections) {
          if (s.enabled) {
            const comment = s.comment ? ` % ${s.comment}` : '';
            result.push(`\\input{${s.file}}${comment}`);
          } else {
            const comment = s.comment ? ` % ${s.comment}` : '';
            result.push(`% \\input{${s.file}}${comment}`);
          }
        }
      }
      // Skip original input lines (we already wrote the new ones)
      continue;
    } else if (inSectionBlock && isBlankOrComment) {
      // Skip blank lines and stray comments between \input lines
      continue;
    } else if (inSectionBlock) {
      inSectionBlock = false;
      sectionBlockDone = true;
    }

    result.push(line);
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// data.tex serializer
// ---------------------------------------------------------------------------

function serializeData(data) {
  const lines = [];

  lines.push(FULL_SEP);
  lines.push('% SHARED DATA \u2014 Single source of truth for resume.tex AND cv.tex');
  lines.push('%');
  lines.push('% Edit values here \u2014 they propagate to all content files automatically.');
  lines.push('% Replace \\tbd{...} placeholders with real values as you collect them.');
  lines.push(FULL_SEP);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('% Placeholder styling \u2014 change rendering of missing data in ONE place');
  lines.push(FULL_SEP);
  lines.push('\\providecommand{\\tbd}[1]{\\textbf{[#1]}}');
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('% Personal Information');
  lines.push(FULL_SEP);

  const p = data.personal;
  // Photo (optional) — only output if enabled and file is set
  if (p.photo && p.photo.enabled && p.photo.file) {
    lines.push(`\\photo[circle,noedge,left]{${san(p.photo.file)}}`);
  }
  lines.push(`\\name{${san(p.firstName || '')}}{${san(p.lastName || '')}} % Legal`);
  if (p.position) lines.push(`\\position{${san(p.position)}}`);
  if (p.address) lines.push(`\\address{${san(p.address)}}`);
  lines.push('');
  if (p.mobile) lines.push(`\\mobile{${san(p.mobile)}}`);
  if (p.email) lines.push(`\\email{${san(p.email)}}`);
  if (p.github) lines.push(`\\github{${san(p.github)}}`);
  if (p.linkedin) lines.push(`\\linkedin{${san(p.linkedin)}}`);
  if (p.homepage) lines.push(`\\homepage{${san(p.homepage)}}`);
  if (p.quote) lines.push('\\quote{``' + san(p.quote) + "''"  + '}');
  lines.push('');

  // Group metrics by group name
  const groups = {};
  for (const m of data.metrics) {
    const g = m.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  }

  for (const [groupName, metrics] of Object.entries(groups)) {
    lines.push('');
    lines.push(FULL_SEP);
    lines.push(`% ${groupName}`);
    lines.push(FULL_SEP);
    for (const m of metrics) {
      if (m.value === null || m.value === undefined) {
        lines.push(`\\providecommand{\\${m.command}}{\\tbd{${san(m.label || m.command)}}}`);
      } else {
        lines.push(`\\providecommand{\\${m.command}}{${san(m.value)}}`);
      }
    }
  }

  return lines.join('\n');
}

// Helper: replace a single-arg command using brace-aware matching
function replaceCommand(tex, commandName, replacement) {
  const { findCommand } = require('./braceExtractor');
  const cmds = findCommand(tex, commandName, 1);
  if (cmds.length > 0) {
    const cmd = cmds[0];
    return tex.substring(0, cmd.startIndex) + replacement + tex.substring(cmd.endIndex);
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Cover letter serializer
// ---------------------------------------------------------------------------

function serializeCoverletter(tex, data) {
  // We do targeted replacements in the original tex to preserve structure
  let result = tex;

  // Replace \recipient{...}{...}
  const recipientPattern = /\\recipient\s*\n?\s*\{[\s\S]*?\}\s*\n?\s*\{[\s\S]*?\}/;
  result = result.replace(recipientPattern,
    `\\recipient\n  {${san(data.recipient.name)}}\n  {${san(data.recipient.address)}}`);

  // Replace \lettertitle{...}
  result = replaceCommand(result, 'lettertitle', `\\lettertitle{${san(data.title)}}`);

  // Replace \letteropening{...}
  result = replaceCommand(result, 'letteropening', `\\letteropening{${san(data.opening)}}`);

  // Replace \letterclosing{...}
  result = replaceCommand(result, 'letterclosing', `\\letterclosing{${san(data.closing)}}`);

  // Replace \letterenclosure[...]{...}
  result = result.replace(/\\letterenclosure\[[^\]]*\]\{[\s\S]*?\}/,
    `\\letterenclosure[${san(data.enclosure.label)}]{${san(data.enclosure.content)}}`);

  // Replace letter body (between \begin{cvletter} and \end{cvletter})
  const bodyContent = data.sections.map(s =>
    `\\lettersection{${san(s.title)}}\n${san(s.body)}`
  ).join('\n\n');

  result = result.replace(
    /\\begin\{cvletter\}[\s\S]*?\\end\{cvletter\}/,
    `\\begin{cvletter}\n\n${bodyContent}\n\n\\end{cvletter}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Filtered section serializer (for resume compilation)
// ---------------------------------------------------------------------------

function serializeFilteredSection(sectionData, configEntry) {
  if (!configEntry) return serializeSection(sectionData);

  // cvparagraph: use resumeText if provided
  if (sectionData.type === 'cvparagraph') {
    const filtered = { ...sectionData };
    if (configEntry.resumeText) {
      filtered.text = configEntry.resumeText;
    }
    return serializeSection(filtered);
  }

  // Types with entries arrays: filter entries and items
  if (!configEntry.entries || !sectionData.entries) {
    return serializeSection(sectionData);
  }

  const filtered = { ...sectionData };
  filtered.entries = [];

  for (let i = 0; i < sectionData.entries.length; i++) {
    const entryConfig = configEntry.entries[i];
    // Default to included if no config for this index
    if (!entryConfig || entryConfig.resume !== false) {
      const entry = { ...sectionData.entries[i] };

      // Filter items/bullets if applicable
      if (entry.items && entryConfig && entryConfig.items) {
        entry.items = entry.items.filter((_, j) =>
          j >= entryConfig.items.length || entryConfig.items[j] !== false
        );
      }

      filtered.entries.push(entry);
    }
  }

  return serializeSection(filtered);
}

module.exports = {
  sanitizeLatex,
  serializeSection,
  serializeFilteredSection,
  serializeDocumentSections,
  serializeData,
  serializeCoverletter
};
