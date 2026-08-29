/**
 * LinkedIn exporter — proven against a faithful slice of real resolved data
 * (person 5 / variant 10), LaTeX artifacts included. The mapping here is the one
 * Step 0 corrected: role = fields.position, company = fields.organization.
 */
const { exportLinkedin, clean, parseRange } = require('../../lib/linkedin');

// A trimmed but verbatim slice of cv_resolve_variant(10): a non-experience section
// first (must be skipped), then three real experience entries with real dates and
// LaTeX (`---`, `\%`, no `title` field — org lives in `organization`).
const RESOLVED = {
  personal: { firstName: 'Andrew', lastName: 'Peterson' },
  sections: [
    {
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      entries: [{ id: 243, fields: { text: 'Ignore me.' }, items: [] }],
    },
    {
      id: 'experience',
      type: 'experience',
      title: 'Experience',
      entries: [
        {
          id: 244,
          fields: {
            date: 'July 2022 -- December 2024',
            location: 'San Diego, CA',
            organization: 'Qualcomm Institute (CALIT2)',
            position: 'Research Intern',
          },
          items: [
            {
              id: 454,
              content:
                'Designed a signaling server (Python/Flask, Socket.IO) with cryptographic room assignment',
            },
            {
              id: 456,
              content:
                "Built parallel solver implementations --- classical brute-force and Grover's quantum search --- for systematic comparison",
            },
          ],
        },
        {
          id: 245,
          fields: {
            date: 'August 2020 -- May 2022',
            location: 'Remote',
            organization: 'RIT Esports',
            position: 'Web Developer',
          },
          items: [
            {
              id: 462,
              content:
                'Maintained 99.9\\% uptime on DigitalOcean Droplets with Nginx reverse proxies',
            },
          ],
        },
        {
          id: 246,
          fields: {
            date: 'March 2020 -- September 2021',
            location: 'Southern California',
            organization: 'Mathnasium',
            position: 'Tutor / IT Lead',
          },
          items: [
            {
              id: 463,
              content: "Led the center's transition to remote operations during COVID-19",
            },
          ],
        },
      ],
    },
  ],
};

describe('exportLinkedin — mapping + shape', () => {
  const { positions } = exportLinkedin(RESOLVED);

  test('reads only the experience section, one block per entry', () => {
    expect(positions).toHaveLength(3);
    expect(positions.map((p) => p.entryId)).toEqual([244, 245, 246]);
  });

  test('role ← fields.position, company ← fields.organization (the Step-0 correction)', () => {
    expect(positions[0].title).toBe('Research Intern');
    expect(positions[0].company).toBe('Qualcomm Institute (CALIT2)'); // NOT fields.title (absent → would be '')
    expect(positions[0].location).toBe('San Diego, CA');
  });

  test('dates: full month names + LaTeX `--` → {month, year}', () => {
    expect(positions[0].start).toEqual({ month: 7, year: 2022 });
    expect(positions[0].end).toEqual({ month: 12, year: 2024 });
    expect(positions[1].start).toEqual({ month: 8, year: 2020 });
  });

  test('descriptions are cleaned + bulleted; no LaTeX leaks through', () => {
    expect(positions[0].description).toContain('• Designed a signaling server');
    expect(positions[0].description).toContain('—'); // `---` became an em-dash
    expect(positions[0].description).not.toContain('---');
    expect(positions[1].description).toContain('99.9% uptime'); // `\%` unescaped
    expect(positions[1].description).not.toContain('\\');
  });
});

describe('exportLinkedin — fingerprint is drift, not noise', () => {
  test('stable across calls and across format (glyph-free)', () => {
    const a = exportLinkedin(RESOLVED, 'linkedin').positions[0].fingerprint;
    const b = exportLinkedin(RESOLVED, 'markdown').positions[0].fingerprint;
    expect(a).toBe(b); // switching presentation must not read as drift
  });

  test('changes when a bullet actually changes', () => {
    const before = exportLinkedin(RESOLVED).positions[0].fingerprint;
    const edited = JSON.parse(JSON.stringify(RESOLVED));
    edited.sections[1].entries[0].items[0].content = 'Rewrote the signaling server';
    const after = exportLinkedin(edited).positions[0].fingerprint;
    expect(after).not.toBe(before);
  });
});

describe('formats + parse edges', () => {
  test('plaintext drops the glyph, markdown uses "-"', () => {
    expect(exportLinkedin(RESOLVED, 'plaintext').positions[2].description).toBe(
      "Led the center's transition to remote operations during COVID-19",
    );
    expect(exportLinkedin(RESOLVED, 'markdown').positions[2].description.startsWith('- ')).toBe(
      true,
    );
  });

  test('year-only range → month null; Present → open end', () => {
    expect(parseRange('2021 -- 2024')).toEqual({
      start: { month: null, year: 2021 },
      end: { month: null, year: 2024 },
    });
    expect(parseRange('June 2021 - Present')).toEqual({
      start: { month: 6, year: 2021 },
      end: null,
    });
  });

  test('clean turns the arrow macro into a glyph', () => {
    expect(clean('Committee \\textrightarrow{} President')).toBe('Committee → President');
  });
});
