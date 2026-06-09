/**
 * Synthetic "kitchen-sink" resolved variant — the portable contract fixture.
 *
 * It exercises every semantic section type (→ all 5 LaTeX types), the
 * education program+major combine, bullets, empty fields, long values, every
 * arity of social link, LaTeX specials (& % $ # _ ^ ~ \) and unicode, plus a
 * cover letter. Both the P0 golden-equivalence test and the P2 verification
 * gate render it; a coverage guard test asserts it still covers every type in
 * latex-type-map.
 *
 * Shape matches db.resolveVariant() output (what the render host consumes).
 */

// Nasty-but-realistic CV text: every special the contract escaper handles
// (& % $ # _ ^ ~), accented unicode, and an em-dash. NOT a bare backslash — the
// wired escaper passes `\` through (to preserve intentional commands), so a
// stray `\word` is an undefined control sequence in ANY layout, not a layout
// defect. Intentional-command pass-through is exercised separately below.
const SPECIALS = 'R&D: 100% of $5M, #1 a_b c^d ~approx — café résumé naïve';

function basePersonal() {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace & Co',
    position: 'Analytical Engine Architect',
    address: '10 Computing Way, London',
    dateofbirth: '1815-12-10',
    mobile: '+44 100% sure',
    email: 'ada@example.com',
    // 1-arg socials
    homepage: 'ada.example.com',
    github: 'ada_lovelace',
    linkedin: 'ada-lovelace',
    orcid: '0000-0001-0002-0003',
    // 2-arg socials
    mastodonInstance: 'mathstodon.xyz',
    mastodonName: 'ada',
    googlescholarId: 'ABC123',
    googlescholarName: 'A. Lovelace',
    stackoverflowId: '42',
    stackoverflowName: 'ada',
    quote: 'That brain of mine is something more than merely mortal — 100% & proud',
    extrainfo: 'References on request (cost: $0)',
    photoEnabled: '1',
    photoFile: 'assets/profile', // resolved from buildDir/assets/ (project assets are copied there)
  };
}

function baseSections() {
  return [
    {
      id: 'experience', type: 'experience', title: 'Experience & Work',
      entries: [
        {
          fields: { position: 'Lead Engineer ' + SPECIALS, organization: 'Babbage Ltd', location: 'London', date: '1843–1845' },
          items: [
            { content: 'Wrote the first algorithm; improved throughput by 50% & more' },
            { content: 'Edge-case specials: a_b, c^d, $cost, #rank, 100%, ~approx' },
            { content: 'Intentional LaTeX passes through: \\textbf{bold} and \\emph{italic}' },
          ],
        },
        // entry with NO items → cventry {} branch
        {
          fields: { position: 'Advisor', organization: 'Royal Society', location: '', date: '1846' },
          items: [],
        },
      ],
    },
    {
      id: 'education', type: 'education', title: 'Education',
      entries: [
        // program + major combine → position
        { fields: { program: 'BSc', major: 'Mathematics', organization: 'University of London', location: 'UK', date: '1830' } },
      ],
    },
    {
      id: 'skills', type: 'skills', title: 'Skills',
      entries: [
        { fields: { category: 'Languages', skills: 'Note G, Assembly & more' } },
        { fields: { category: 'Tools', skills: 'Difference Engine' } },
      ],
    },
    {
      id: 'honors', type: 'honors', title: 'Honors',
      entries: [
        { fields: { award: 'First Programmer', issuer: 'History', location: 'Worldwide', date: '1843' } },
      ],
    },
    {
      id: 'certifications', type: 'certifications', title: 'Certifications',
      entries: [
        { fields: { award: 'Certified Analyst', issuer: 'Guild & Co', location: 'ID #7', date: '1840' } },
      ],
    },
    {
      id: 'summary', type: 'summary', title: 'Summary',
      entries: [
        { fields: { text: 'Visionary of computing. ' + SPECIALS } },
      ],
    },
    {
      id: 'references', type: 'references', title: 'References',
      entries: [
        { fields: { name: 'Charles Babbage', relation: 'Collaborator', phone: '+44 000', email: 'charles@example.com' } },
      ],
    },
  ];
}

function baseCoverletter() {
  return {
    recipientName: 'Hiring Committee & Partners',
    recipientAddress: '1 Innovation Rd, 100% Place',
    title: 'Application: Engineer (#1 choice)',
    opening: 'Dear Committee,',
    closing: 'Sincerely,',
    enclosureLabel: 'Enclosed',
    enclosureContent: 'CV & portfolio',
    sections: [
      { title: 'Why me', body: 'I bring rigor & vision. ' + SPECIALS },
      { title: 'Closing', body: 'Thank you for your consideration ($0 risk).' },
    ],
  };
}

/**
 * @param {object} [overrides] - { variant, style, spacing, fonts, personal, sections, coverletter }
 * @returns {object} a resolved-variant compileData object
 */
function makeKitchenSink(overrides = {}) {
  const variant = overrides.variant || 'cv';
  const isLetter = variant === 'coverletter';
  return {
    variant,
    personal: overrides.personal || basePersonal(),
    sections: isLetter ? [] : (overrides.sections || baseSections()),
    coverletter: isLetter ? (overrides.coverletter || baseCoverletter()) : (overrides.coverletter || null),
    style: overrides.style || {},
    spacing: overrides.spacing || {},
    fonts: overrides.fonts || {},
  };
}

module.exports = { makeKitchenSink, basePersonal, baseSections, baseCoverletter, SPECIALS };
