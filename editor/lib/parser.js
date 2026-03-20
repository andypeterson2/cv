/**
 * LaTeX → JSON parsers for all section types in the awesome-cv project.
 */

const { extractBraceArgs, findCommand } = require('./braceExtractor');

// ---------------------------------------------------------------------------
// Section type detection
// ---------------------------------------------------------------------------

function detectSectionType(tex) {
  if (/\\begin\{cventries\}/.test(tex)) return 'cventries';
  if (/\\begin\{cvskills\}/.test(tex)) return 'cvskills';
  if (/\\begin\{cvhonors\}/.test(tex)) return 'cvhonors';
  if (/\\begin\{cvreferences\}/.test(tex)) return 'cvreferences';
  if (/\\begin\{cvparagraph\}/.test(tex)) return 'cvparagraph';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Parse section title
// ---------------------------------------------------------------------------

function parseSectionTitle(tex) {
  const m = tex.match(/\\cvsection\{([^}]+)\}/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// cventries (experience, education, extracurricular)
// ---------------------------------------------------------------------------

function parseCventries(tex) {
  const title = parseSectionTitle(tex);
  const entries = [];

  const commands = findCommand(tex, 'cventry', 5);
  for (const cmd of commands) {
    const [position, organization, location, date, description] = cmd.args;

    // Extract \item{...} or \item {...} from the description
    const items = [];
    const itemPattern = /\\item\s*\{/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(description)) !== null) {
      // Find the opening brace position (the { after \item)
      const braceStart = description.indexOf('{', itemMatch.index + 5);
      try {
        const { args } = extractBraceArgs(description, braceStart, 1);
        items.push(args[0]);
      } catch (e) {
        // Fallback: grab text until next \item or \end
      }
    }

    entries.push({
      position: position.trim(),
      organization: organization.trim(),
      location: location.trim(),
      date: date.trim(),
      items
    });
  }

  return { type: 'cventries', title, entries };
}

// ---------------------------------------------------------------------------
// cvskills
// ---------------------------------------------------------------------------

function parseCvskills(tex) {
  const title = parseSectionTitle(tex);
  const commands = findCommand(tex, 'cvskill', 2);
  const entries = commands.map(cmd => ({
    category: cmd.args[0].trim(),
    skills: cmd.args[1].trim()
  }));
  return { type: 'cvskills', title, entries };
}

// ---------------------------------------------------------------------------
// cvhonors (certifications, honors)
// ---------------------------------------------------------------------------

function parseCvhonors(tex) {
  const title = parseSectionTitle(tex);
  const commands = findCommand(tex, 'cvhonor', 4);
  const entries = commands.map(cmd => ({
    award: cmd.args[0].trim(),
    issuer: cmd.args[1].trim(),
    location: cmd.args[2].trim(),
    date: cmd.args[3].trim()
  }));
  return { type: 'cvhonors', title, entries };
}

// ---------------------------------------------------------------------------
// cvreferences
// ---------------------------------------------------------------------------

function parseCvreferences(tex) {
  const title = parseSectionTitle(tex);
  const commands = findCommand(tex, 'cvreference', 4);
  const entries = commands.map(cmd => ({
    name: cmd.args[0].trim(),
    relation: cmd.args[1].trim(),
    phone: cmd.args[2].trim(),
    email: cmd.args[3].trim()
  }));
  return { type: 'cvreferences', title, entries };
}

// ---------------------------------------------------------------------------
// cvparagraph (summary)
// ---------------------------------------------------------------------------

function parseCvparagraph(tex) {
  const title = parseSectionTitle(tex);
  const m = tex.match(/\\begin\{cvparagraph\}([\s\S]*?)\\end\{cvparagraph\}/);
  let text = '';
  if (m) {
    // Strip comment lines and leading/trailing whitespace
    text = m[1]
      .split('\n')
      .filter(line => !line.trim().startsWith('%'))
      .join('\n')
      .trim();
  }
  return { type: 'cvparagraph', title, text };
}

// ---------------------------------------------------------------------------
// Auto-detect and parse any section file
// ---------------------------------------------------------------------------

function parseSection(tex) {
  const type = detectSectionType(tex);
  switch (type) {
    case 'cventries': return parseCventries(tex);
    case 'cvskills': return parseCvskills(tex);
    case 'cvhonors': return parseCvhonors(tex);
    case 'cvreferences': return parseCvreferences(tex);
    case 'cvparagraph': return parseCvparagraph(tex);
    default: return { type: 'unknown', title: parseSectionTitle(tex), raw: tex };
  }
}

// ---------------------------------------------------------------------------
// Document parser (resume.tex / cv.tex) — extract \input ordering
// ---------------------------------------------------------------------------

function parseDocument(tex) {
  const sections = [];
  const lines = tex.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Active section: \input{resume/experience.tex}
    const activeMatch = trimmed.match(/^\\input\{([^}]+)\}/);
    if (activeMatch) {
      // Skip data.tex — it's the shared data file, not a content section
      if (activeMatch[1] === 'data.tex') continue;
      const comment = trimmed.includes('%') ?
        trimmed.substring(trimmed.indexOf('%') + 1).trim() : '';
      sections.push({ file: activeMatch[1], enabled: true, comment });
      continue;
    }

    // Commented-out section: % \input{resume/honors.tex}
    const commentedMatch = trimmed.match(/^%\s*\\input\{([^}]+)\}/);
    if (commentedMatch) {
      const rest = trimmed.substring(trimmed.indexOf('}') + 1).trim();
      const comment = rest.startsWith('%') ? rest.substring(1).trim() : rest;
      sections.push({ file: commentedMatch[1], enabled: false, comment });
    }
  }

  return { sections };
}

// ---------------------------------------------------------------------------
// data.tex parser
// ---------------------------------------------------------------------------

function parseData(tex) {
  const personal = {};
  const metrics = [];

  const lines = tex.split('\n');
  let currentGroup = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Track group headings from comment blocks: % Qualcomm Institute — ...
    // Pattern: a comment line between two %--- separator lines
    if (trimmed.startsWith('%') && !trimmed.startsWith('%---') && !trimmed.startsWith('%-')) {
      const heading = trimmed.replace(/^%\s*/, '');
      if (heading && !heading.startsWith('Edit') && !heading.startsWith('Replace') &&
          !heading.startsWith('Placeholder') && !heading.startsWith('SHARED') &&
          !heading.startsWith('Personal') && heading.length > 3) {
        currentGroup = heading;
      }
    }

    // Personal info: \name{first}{last}
    const nameMatch = trimmed.match(/^\\name\{([^}]*)\}\{([^}]*)\}/);
    if (nameMatch && !trimmed.startsWith('%')) {
      personal.firstName = nameMatch[1];
      personal.lastName = nameMatch[2];
      continue;
    }

    // Personal info: single-arg commands
    const singleArgCmds = ['position', 'address', 'mobile', 'email', 'github', 'linkedin', 'homepage'];
    let matched = false;
    for (const cmd of singleArgCmds) {
      const re = new RegExp(`^\\\\${cmd}\\{`);
      if (re.test(trimmed)) {
        try {
          const { args } = extractBraceArgs(trimmed, trimmed.indexOf('{'), 1);
          personal[cmd] = args[0];
        } catch (e) { /* skip malformed */ }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Metrics: \providecommand{\cmdName}{value} or \newcommand{\cmdName}{value}
    const metricMatch = trimmed.match(/^\\(?:provide|new)command\{\\(\w+)\}\{([\s\S]*)\}$/);
    if (metricMatch) {
      const command = metricMatch[1];
      if (command === 'tbd') continue; // Skip the \tbd definition itself

      const rawValue = metricMatch[2];
      // Check if it's a \tbd{label} placeholder
      const tbdMatch = rawValue.match(/^\\tbd\{(.*)\}$/);
      if (tbdMatch) {
        metrics.push({ command, label: tbdMatch[1], value: null, group: currentGroup });
      } else {
        metrics.push({ command, label: command, value: rawValue, group: currentGroup });
      }
    }
  }

  return { personal, metrics };
}

// ---------------------------------------------------------------------------
// Cover letter parser
// ---------------------------------------------------------------------------

function parseCoverletter(tex) {
  const result = {
    recipient: { name: '', address: '' },
    title: '',
    opening: '',
    closing: '',
    enclosure: { label: 'Attached', content: '' },
    sections: []
  };

  // \recipient{name}{address}
  const recipientCmds = findCommand(tex, 'recipient', 2);
  if (recipientCmds.length > 0) {
    result.recipient.name = recipientCmds[0].args[0].trim();
    result.recipient.address = recipientCmds[0].args[1].trim();
  }

  // \lettertitle{...}
  const titleCmds = findCommand(tex, 'lettertitle', 1);
  if (titleCmds.length > 0) result.title = titleCmds[0].args[0].trim();

  // \letteropening{...}
  const openCmds = findCommand(tex, 'letteropening', 1);
  if (openCmds.length > 0) result.opening = openCmds[0].args[0].trim();

  // \letterclosing{...}
  const closeCmds = findCommand(tex, 'letterclosing', 1);
  if (closeCmds.length > 0) result.closing = closeCmds[0].args[0].trim();

  // \letterenclosure[label]{content}
  const encMatch = tex.match(/\\letterenclosure\[([^\]]*)\]\{([^}]*)\}/);
  if (encMatch) {
    result.enclosure.label = encMatch[1];
    result.enclosure.content = encMatch[2];
  }

  // \lettersection{title}\nbody text until next \lettersection or \end{cvletter}
  const letterBody = tex.match(/\\begin\{cvletter\}([\s\S]*?)\\end\{cvletter\}/);
  if (letterBody) {
    const body = letterBody[1];
    const sectionPattern = /\\lettersection\{([^}]+)\}/g;
    let sMatch;
    const sectionStarts = [];

    while ((sMatch = sectionPattern.exec(body)) !== null) {
      sectionStarts.push({ title: sMatch[1], index: sMatch.index, end: sMatch.index + sMatch[0].length });
    }

    for (let i = 0; i < sectionStarts.length; i++) {
      const start = sectionStarts[i].end;
      const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : body.length;
      const sectionBody = body.substring(start, end).trim();
      result.sections.push({ title: sectionStarts[i].title, body: sectionBody });
    }
  }

  return result;
}

module.exports = {
  parseSection,
  parseDocument,
  parseData,
  parseCoverletter,
  detectSectionType,
  parseSectionTitle
};
