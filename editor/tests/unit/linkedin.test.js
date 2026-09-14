/**
 * LinkedIn exporter against data shaped like a resolved variant, LaTeX artifacts
 * included: role = fields.position, company = fields.organization.
 */
const { exportLinkedin, clean, parseRange } = require('../../lib/linkedin');

// A non-experience section first (must be skipped), then three experience entries
// with dates and LaTeX (`---`, `\%`, no `title` field — the company lives in `organization`).
const RESOLVED = {
  personal: { firstName: 'Jane', lastName: 'Doe' },
  sections: [
    {
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      entries: [{ id: 1, fields: { text: 'Ignore me.' }, items: [] }],
    },
    {
      id: 'experience',
      type: 'experience',
      title: 'Experience',
      entries: [
        {
          id: 101,
          fields: {
            date: 'July 2022 -- December 2024',
            location: 'Springfield, IL',
            organization: 'Example Research Lab',
            position: 'Research Assistant',
          },
          items: [
            {
              id: 11,
              content:
                'Designed a signaling server (Python/Flask, Socket.IO) with cryptographic room assignment',
            },
            {
              id: 12,
              content:
                'Built two solver implementations --- brute force and backtracking search --- for side-by-side comparison',
            },
          ],
        },
        {
          id: 102,
          fields: {
            date: 'August 2020 -- May 2022',
            location: 'Remote',
            organization: 'Example Gaming Club',
            position: 'Web Developer',
          },
          items: [
            {
              id: 21,
              content: 'Maintained 99.9\\% uptime on a web server behind an Nginx reverse proxy',
            },
          ],
        },
        {
          id: 103,
          fields: {
            date: 'March 2020 -- September 2021',
            location: 'Springfield, IL',
            organization: 'Example Tutoring Center',
            position: 'Tutor',
          },
          items: [
            {
              id: 31,
              content: "Led the center's transition to remote tutoring sessions",
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
    expect(positions.map((p) => p.entryId)).toEqual([101, 102, 103]);
  });

  test('role ← fields.position, company ← fields.organization', () => {
    expect(positions[0].title).toBe('Research Assistant');
    expect(positions[0].company).toBe('Example Research Lab'); // NOT fields.title (absent → would be '')
    expect(positions[0].location).toBe('Springfield, IL');
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
      "Led the center's transition to remote tutoring sessions",
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
