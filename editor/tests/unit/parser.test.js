const {
  parseSection,
  parseDocument,
  parseData,
  parseCoverletter,
  detectSectionType,
  parseSectionTitle
} = require('../../lib/parser');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.resolve(__dirname, '..', '..', '..'); // project root

// Helper to read fixture files
function readFixture(relPath) {
  return fs.readFileSync(path.join(FIXTURES, relPath), 'utf-8');
}

// ---- detectSectionType ----

describe('detectSectionType', () => {
  test('detects cventries', () => {
    expect(detectSectionType('\\begin{cventries}')).toBe('cventries');
  });

  test('detects cvskills', () => {
    expect(detectSectionType('\\begin{cvskills}')).toBe('cvskills');
  });

  test('detects cvhonors', () => {
    expect(detectSectionType('\\begin{cvhonors}')).toBe('cvhonors');
  });

  test('detects cvparagraph', () => {
    expect(detectSectionType('\\begin{cvparagraph}')).toBe('cvparagraph');
  });

  test('detects cvreferences', () => {
    expect(detectSectionType('\\begin{cvreferences}')).toBe('cvreferences');
  });

  test('returns unknown for unrecognized', () => {
    expect(detectSectionType('just some text')).toBe('unknown');
  });
});

// ---- parseSectionTitle ----

describe('parseSectionTitle', () => {
  test('extracts section title', () => {
    expect(parseSectionTitle('\\cvsection{Experience}')).toBe('Experience');
  });

  test('returns empty string when no title', () => {
    expect(parseSectionTitle('no title here')).toBe('');
  });
});

// ---- parseSection: cventries ----

describe('parseSection - cventries (experience)', () => {
  let parsed;

  beforeAll(() => {
    const tex = readFixture('cv/experience.tex');
    parsed = parseSection(tex);
  });

  test('detects type as cventries', () => {
    expect(parsed.type).toBe('cventries');
  });

  test('extracts section title', () => {
    expect(parsed.title).toBe('Experience');
  });

  test('finds all entries', () => {
    expect(parsed.entries).toHaveLength(3);
  });

  test('parses first entry fields correctly', () => {
    const entry = parsed.entries[0];
    expect(entry.position).toBe('Quantum Software Engineering Lead (Intern)');
    expect(entry.organization).toBe('Qualcomm Institute');
    expect(entry.location).toBe('La Jolla, California');
    expect(entry.date).toBe('Jul. 2022 - Dec. 2024');
  });

  test('parses bullet points', () => {
    expect(parsed.entries[0].items.length).toBe(4);
    expect(parsed.entries[1].items.length).toBe(3);
    expect(parsed.entries[2].items.length).toBe(2);
  });

  test('bullet content includes LaTeX commands', () => {
    const firstBullet = parsed.entries[0].items[0];
    expect(firstBullet).toContain('\\qiQubitCount{}');
  });

  test('parses Mathnasium entry correctly', () => {
    const entry = parsed.entries[2];
    expect(entry.organization).toBe('Mathnasium');
    expect(entry.position).toContain('Instructor');
  });
});

// ---- parseSection: cvskills ----

describe('parseSection - cvskills', () => {
  let parsed;

  beforeAll(() => {
    const tex = readFixture('cv/skills.tex');
    parsed = parseSection(tex);
  });

  test('detects type as cvskills', () => {
    expect(parsed.type).toBe('cvskills');
  });

  test('extracts title', () => {
    expect(parsed.title).toBe('Skills');
  });

  test('finds all skill categories', () => {
    expect(parsed.entries.length).toBe(8);
  });

  test('parses skill category and skills', () => {
    expect(parsed.entries[0].category).toBe('Languages');
    expect(parsed.entries[0].skills).toContain('Python');
  });

  test('handles escaped ampersands in category names', () => {
    const sysEntry = parsed.entries.find(e => e.category.includes('Systems'));
    expect(sysEntry.category).toContain('\\&');
  });
});

// ---- parseSection: cvhonors ----

describe('parseSection - cvhonors (certifications)', () => {
  let parsed;

  beforeAll(() => {
    const tex = readFixture('cv/certifications.tex');
    parsed = parseSection(tex);
  });

  test('detects type as cvhonors', () => {
    expect(parsed.type).toBe('cvhonors');
  });

  test('extracts title', () => {
    expect(parsed.title).toBe('Certifications');
  });

  test('finds all entries', () => {
    expect(parsed.entries).toHaveLength(2);
  });

  test('parses honor fields', () => {
    const first = parsed.entries[0];
    expect(first.award).toBe('Azure Data Fundamentals');
    expect(first.issuer).toBe('Microsoft');
    expect(first.date).toBe('2025');
  });

  test('handles empty location field', () => {
    expect(parsed.entries[0].location).toBe('');
    expect(parsed.entries[1].location).toBe('');
  });
});

// ---- parseSection: cvparagraph ----

describe('parseSection - cvparagraph (summary)', () => {
  let parsed;

  beforeAll(() => {
    const tex = readFixture('cv/summary.tex');
    parsed = parseSection(tex);
  });

  test('detects type as cvparagraph', () => {
    expect(parsed.type).toBe('cvparagraph');
  });

  test('extracts title', () => {
    expect(parsed.title).toBe('Summary');
  });

  test('extracts paragraph text', () => {
    expect(parsed.text).toContain('full-stack software engineer');
    expect(parsed.text.length).toBeGreaterThan(100);
  });

  test('strips comment lines from text', () => {
    expect(parsed.text).not.toContain('%-');
  });
});

// ---- parseDocument ----

describe('parseDocument', () => {
  let result;

  beforeAll(() => {
    const tex = readFixture('cv.tex');
    result = parseDocument(tex);
  });

  test('returns sections array', () => {
    expect(result.sections).toBeDefined();
    expect(Array.isArray(result.sections)).toBe(true);
  });

  test('finds enabled sections', () => {
    const enabled = result.sections.filter(s => s.enabled);
    expect(enabled.length).toBeGreaterThanOrEqual(4);
  });

  test('finds commented-out sections', () => {
    const disabled = result.sections.filter(s => !s.enabled);
    expect(disabled.length).toBeGreaterThanOrEqual(1);
  });

  test('skips data.tex', () => {
    const dataSection = result.sections.find(s => s.file === 'data.tex');
    expect(dataSection).toBeUndefined();
  });

  test('sections have file, enabled, comment fields', () => {
    for (const s of result.sections) {
      expect(s).toHaveProperty('file');
      expect(s).toHaveProperty('enabled');
      expect(typeof s.enabled).toBe('boolean');
    }
  });

  test('preserves section order from tex file', () => {
    const files = result.sections.map(s => s.file);
    const eduIdx = files.indexOf('cv/education.tex');
    const expIdx = files.indexOf('cv/experience.tex');
    // education comes before experience in cv.tex
    expect(eduIdx).toBeLessThan(expIdx);
  });
});

// ---- parseData ----

describe('parseData', () => {
  let data;

  beforeAll(() => {
    const tex = readFixture('data.tex');
    data = parseData(tex);
  });

  test('parses personal info', () => {
    expect(data.personal.firstName).toBe('Andrew');
    expect(data.personal.lastName).toBe('Peterson');
  });

  test('parses position', () => {
    expect(data.personal.position).toContain('Quantum Researcher');
  });

  test('parses contact info', () => {
    expect(data.personal.mobile).toContain('951-551-6946');
    expect(data.personal.email).toBe('acpeters@ucsd.edu');
    expect(data.personal.github).toBe('andypeterson2');
    expect(data.personal.linkedin).toBe('i-am-andy-peterson');
  });

  test('parses metrics array', () => {
    expect(Array.isArray(data.metrics)).toBe(true);
    expect(data.metrics.length).toBeGreaterThanOrEqual(15);
  });

  test('metric has correct structure', () => {
    const metric = data.metrics[0];
    expect(metric).toHaveProperty('command');
    expect(metric).toHaveProperty('label');
    expect(metric).toHaveProperty('group');
    expect(metric).toHaveProperty('value');
  });

  test('parses tbd placeholder values as null', () => {
    const qiQubit = data.metrics.find(m => m.command === 'qiQubitCount');
    expect(qiQubit).toBeDefined();
    expect(qiQubit.value).toBeNull();
    expect(qiQubit.label).toBe('qubit count');
  });

  test('groups metrics by comment headings', () => {
    const ritMetrics = data.metrics.filter(m => m.group.includes('RIT'));
    expect(ritMetrics.length).toBeGreaterThanOrEqual(3);
  });

  test('skips \\tbd command definition', () => {
    const tbdMetric = data.metrics.find(m => m.command === 'tbd');
    expect(tbdMetric).toBeUndefined();
  });
});

// ---- parseCoverletter ----

describe('parseCoverletter', () => {
  let cl;

  beforeAll(() => {
    const tex = readFixture('coverletter.tex');
    cl = parseCoverletter(tex);
  });

  test('parses recipient', () => {
    expect(cl.recipient.name).toBe('Company Recruitment Team');
    expect(cl.recipient.address).toContain('Company Name');
  });

  test('parses opening', () => {
    expect(cl.opening).toContain('Dear');
  });

  test('parses closing', () => {
    expect(cl.closing).toBe('Sincerely,');
  });

  test('parses enclosure', () => {
    expect(cl.enclosure.label).toBe('Attached');
    expect(cl.enclosure.content).toBe('Curriculum Vitae');
  });

  test('parses letter sections', () => {
    expect(cl.sections.length).toBeGreaterThanOrEqual(2);
    expect(cl.sections[0].title).toBe('About Me');
    expect(cl.sections[1].title).toBe('Why Me?');
  });

  test('letter section body is non-empty', () => {
    for (const sec of cl.sections) {
      expect(sec.body.length).toBeGreaterThan(10);
    }
  });
});
