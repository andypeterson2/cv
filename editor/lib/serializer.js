/**
 * JSON → LaTeX serializers for all section types in the awesome-cv project.
 * Reproduces the project's formatting conventions.
 */

const SEP = '%---------------------------------------------------------';
const FULL_SEP = '%-------------------------------------------------------------------------------';

/**
 * Escape bare LaTeX special characters in user-provided text.
 * Preserves intentional LaTeX commands (e.g. \textbf{...}) while escaping
 * bare special characters that would break compilation.
 */
function escTex(str) {
  if (!str) return str;
  return String(str)
    .replace(/(?<!\\)&/g, '\\&')
    .replace(/(?<!\\)%/g, '\\%')
    .replace(/(?<!\\)\$/g, '\\$')
    .replace(/(?<!\\)#/g, '\\#')
    .replace(/(?<!\\)_/g, '\\_')
    .replace(/(?<!\\)~/g, '\\textasciitilde{}')
    .replace(/(?<!\\)\^/g, '\\textasciicircum{}');
}

// ---------------------------------------------------------------------------
// cventries (experience, education, extracurricular)
// ---------------------------------------------------------------------------

function serializeCventries(data) {
  const lines = [];
  lines.push(FULL_SEP);
  lines.push('% SECTION TITLE');
  lines.push(FULL_SEP);
  lines.push(`\\cvsection{${escTex(data.title)}}`);
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
    lines.push(`    {${escTex(e.position)}}`);
    lines.push(`    {${escTex(e.organization)}}`);
    lines.push(`    {${escTex(e.location)}}`);
    lines.push(`    {${escTex(e.date)}}`);

    if (e.items && e.items.length > 0) {
      lines.push('    {');
      lines.push('      \\begin{cvitems}');
      for (const item of e.items) {
        lines.push(`        \\item {${escTex(item)}}`);
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
  lines.push(`\\cvsection{${escTex(data.title)}}`);
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
    lines.push(`    {${escTex(e.category)}}`);
    lines.push(`    {${escTex(e.skills)}}`);
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
  lines.push(`\\cvsection{${escTex(data.title)}}`);
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
    lines.push(`    {${escTex(e.award)}} % Name`);
    lines.push(`    {${escTex(e.issuer)}} % Issuer`);
    lines.push(`    {${escTex(e.location)}} % Credential ID`);
    lines.push(`    {${escTex(e.date)}} % Date(s)`);
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
  lines.push(`\\cvsection{${escTex(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('%\tCONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cvreferences}');

  for (const e of data.entries) {
    lines.push('  \\cvreference');
    lines.push(`    {${escTex(e.name)}}`);
    lines.push(`    {${escTex(e.relation)}}`);
    lines.push(`    {${escTex(e.phone)}}`);
    lines.push(`    {${escTex(e.email)}}`);
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
  lines.push(`\\cvsection{${escTex(data.title)}}`);
  lines.push('');
  lines.push('');
  lines.push(FULL_SEP);
  lines.push('% CONTENT');
  lines.push(FULL_SEP);
  lines.push('\\begin{cvparagraph}');
  lines.push('');
  lines.push(SEP);
  lines.push(data.text);
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
    } else if (inSectionBlock && !isInputLine) {
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
    lines.push(`\\photo[circle,noedge,left]{${p.photo.file}}`);
  }
  lines.push(`\\name{${escTex(p.firstName || '')}}{${escTex(p.lastName || '')}} % Legal`);
  if (p.position) lines.push(`\\position{${escTex(p.position)}}`);
  if (p.address) lines.push(`\\address{${escTex(p.address)}}`);
  if (p.dateofbirth) lines.push(`\\dateofbirth{${escTex(p.dateofbirth)}}`);
  lines.push('');

  // Contact
  if (p.mobile) lines.push(`\\mobile{${p.mobile}}`);
  if (p.email) lines.push(`\\email{${p.email}}`);
  if (p.whatsapp) lines.push(`\\whatsapp{${p.whatsapp}}`);
  if (p.skype) lines.push(`\\skype{${p.skype}}`);
  if (p.telegram) lines.push(`\\telegram{${p.telegram}}`);
  lines.push('');

  // Web & code
  if (p.homepage) lines.push(`\\homepage{${p.homepage}}`);
  if (p.github) lines.push(`\\github{${p.github}}`);
  if (p.linkedin) lines.push(`\\linkedin{${p.linkedin}}`);
  if (p.gitlab) lines.push(`\\gitlab{${p.gitlab}}`);
  if (p.bitbucket) lines.push(`\\bitbucket{${p.bitbucket}}`);
  lines.push('');

  // Social
  if (p.twitter) lines.push(`\\twitter{${p.twitter}}`);
  if (p.x) lines.push(`\\x{${p.x}}`);
  if (p.reddit) lines.push(`\\reddit{${p.reddit}}`);
  if (p.medium) lines.push(`\\medium{${p.medium}}`);
  if (p.xing) lines.push(`\\xing{${p.xing}}`);
  if (p.mastodonInstance && p.mastodonName) lines.push(`\\mastodon{${p.mastodonInstance}}{${p.mastodonName}}`);
  lines.push('');

  // Academic
  if (p.orcid) lines.push(`\\orcid{${p.orcid}}`);
  if (p.researchgate) lines.push(`\\researchgate{${p.researchgate}}`);
  if (p.kaggle) lines.push(`\\kaggle{${p.kaggle}}`);
  if (p.hackerrank) lines.push(`\\hackerrank{${p.hackerrank}}`);
  if (p.stackoverflowId) lines.push(`\\stackoverflow{${p.stackoverflowId}}{${p.stackoverflowName || ''}}`);
  if (p.googlescholarId) lines.push(`\\googlescholar{${p.googlescholarId}}{${p.googlescholarName || ''}}`);
  lines.push('');

  // Other
  if (p.extrainfo) lines.push(`\\extrainfo{${p.extrainfo}}`);
  if (p.quote) lines.push('\\quote{``' + p.quote + "''"  + '}');
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
        // Escape bare % in labels so LaTeX doesn't treat them as comments
        const safeLabel = (m.label || m.command).replace(/%/g, '\\%');
        lines.push(`\\providecommand{\\${m.command}}{\\tbd{${safeLabel}}}`);
      } else {
        lines.push(`\\providecommand{\\${m.command}}{${m.value}}`);
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
    `\\recipient\n  {${escTex(data.recipient.name)}}\n  {${escTex(data.recipient.address)}}`);

  // Replace \lettertitle{...}
  result = replaceCommand(result, 'lettertitle', `\\lettertitle{${escTex(data.title)}}`);

  // Replace \letteropening{...}
  result = replaceCommand(result, 'letteropening', `\\letteropening{${escTex(data.opening)}}`);

  // Replace \letterclosing{...}
  result = replaceCommand(result, 'letterclosing', `\\letterclosing{${escTex(data.closing)}}`);

  // Replace \letterenclosure[...]{...}
  result = result.replace(/\\letterenclosure\[[^\]]*\]\{[\s\S]*?\}/,
    `\\letterenclosure[${escTex(data.enclosure.label)}]{${escTex(data.enclosure.content)}}`);

  // Replace letter body (between \begin{cvletter} and \end{cvletter})
  const bodyContent = data.sections.map(s =>
    `\\lettersection{${escTex(s.title)}}\n${s.body}`
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
  escTex,
  serializeSection,
  serializeFilteredSection,
  serializeDocumentSections,
  serializeData,
  serializeCoverletter
};
