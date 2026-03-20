const {
  serializeSection,
  serializeFilteredSection,
  serializeDocumentSections,
  serializeData,
  serializeCoverletter
} = require('../../lib/serializer');

// ---- serializeSection: cventries ----

describe('serializeSection - cventries', () => {
  const data = {
    type: 'cventries',
    title: 'Experience',
    entries: [
      {
        position: 'Engineer',
        organization: 'Acme Corp',
        location: 'Remote',
        date: '2023 - Present',
        items: ['Built systems', 'Led team']
      }
    ]
  };

  test('produces valid LaTeX', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\cvsection{Experience}');
    expect(tex).toContain('\\begin{cventries}');
    expect(tex).toContain('\\end{cventries}');
  });

  test('includes entry fields', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('{Engineer}');
    expect(tex).toContain('{Acme Corp}');
    expect(tex).toContain('{Remote}');
    expect(tex).toContain('{2023 - Present}');
  });

  test('includes bullet items', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\item {Built systems}');
    expect(tex).toContain('\\item {Led team}');
    expect(tex).toContain('\\begin{cvitems}');
    expect(tex).toContain('\\end{cvitems}');
  });

  test('handles empty items array', () => {
    const empty = { ...data, entries: [{ ...data.entries[0], items: [] }] };
    const tex = serializeSection(empty);
    expect(tex).toContain('{}');
    expect(tex).not.toContain('\\begin{cvitems}');
  });

  test('serializes multiple entries', () => {
    const multi = {
      ...data,
      entries: [data.entries[0], { ...data.entries[0], organization: 'Other Corp' }]
    };
    const tex = serializeSection(multi);
    expect(tex).toContain('Acme Corp');
    expect(tex).toContain('Other Corp');
  });
});

// ---- serializeSection: cvskills ----

describe('serializeSection - cvskills', () => {
  const data = {
    type: 'cvskills',
    title: 'Skills',
    entries: [
      { category: 'Languages', skills: 'Python, Rust, Go' },
      { category: 'Tools', skills: 'Docker, Git' }
    ]
  };

  test('produces valid LaTeX', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\cvsection{Skills}');
    expect(tex).toContain('\\begin{cvskills}');
    expect(tex).toContain('\\end{cvskills}');
  });

  test('includes skill entries', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\cvskill');
    expect(tex).toContain('{Languages}');
    expect(tex).toContain('{Python, Rust, Go}');
  });
});

// ---- serializeSection: cvhonors ----

describe('serializeSection - cvhonors', () => {
  const data = {
    type: 'cvhonors',
    title: 'Certifications',
    entries: [
      { award: 'AWS Solutions Architect', issuer: 'Amazon', location: '', date: '2024' }
    ]
  };

  test('produces valid LaTeX', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\cvsection{Certifications}');
    expect(tex).toContain('\\begin{cvhonors}');
    expect(tex).toContain('\\end{cvhonors}');
  });

  test('includes honor fields with comments', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('{AWS Solutions Architect} % Name');
    expect(tex).toContain('{Amazon} % Issuer');
    expect(tex).toContain('{2024} % Date(s)');
  });
});

// ---- serializeSection: cvparagraph ----

describe('serializeSection - cvparagraph', () => {
  const data = {
    type: 'cvparagraph',
    title: 'Summary',
    text: 'I am a software engineer.'
  };

  test('produces valid LaTeX', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\cvsection{Summary}');
    expect(tex).toContain('\\begin{cvparagraph}');
    expect(tex).toContain('\\end{cvparagraph}');
    expect(tex).toContain('I am a software engineer.');
  });
});

// ---- serializeSection: cvreferences ----

describe('serializeSection - cvreferences', () => {
  const data = {
    type: 'cvreferences',
    title: 'References',
    entries: [
      { name: 'Dr. Smith', relation: 'Advisor', phone: '555-0100', email: 'smith@edu' }
    ]
  };

  test('produces valid LaTeX', () => {
    const tex = serializeSection(data);
    expect(tex).toContain('\\begin{cvreferences}');
    expect(tex).toContain('\\cvreference');
    expect(tex).toContain('{Dr. Smith}');
  });
});

// ---- serializeSection: unknown type throws ----

describe('serializeSection - error handling', () => {
  test('throws on unknown type', () => {
    expect(() => serializeSection({ type: 'bogus' })).toThrow('Unknown section type');
  });
});

// ---- serializeFilteredSection ----

describe('serializeFilteredSection', () => {
  const sectionData = {
    type: 'cventries',
    title: 'Experience',
    entries: [
      { position: 'A', organization: 'Org A', location: '', date: '', items: ['bullet1', 'bullet2', 'bullet3'] },
      { position: 'B', organization: 'Org B', location: '', date: '', items: ['b1', 'b2'] },
      { position: 'C', organization: 'Org C', location: '', date: '', items: ['c1'] }
    ]
  };

  test('returns full section when no config', () => {
    const tex = serializeFilteredSection(sectionData, null);
    expect(tex).toContain('Org A');
    expect(tex).toContain('Org B');
    expect(tex).toContain('Org C');
  });

  test('filters out entries with resume=false', () => {
    const config = {
      entries: [
        { resume: true, items: [] },
        { resume: false, items: [] },
        { resume: true, items: [] }
      ]
    };
    const tex = serializeFilteredSection(sectionData, config);
    expect(tex).toContain('Org A');
    expect(tex).not.toContain('Org B');
    expect(tex).toContain('Org C');
  });

  test('filters out individual bullets with items[i]=false', () => {
    const config = {
      entries: [
        { resume: true, items: [true, false, true] },
        { resume: true, items: [] },
        { resume: true, items: [] }
      ]
    };
    const tex = serializeFilteredSection(sectionData, config);
    expect(tex).toContain('bullet1');
    expect(tex).not.toContain('bullet2');
    expect(tex).toContain('bullet3');
  });

  test('uses resumeText for cvparagraph', () => {
    const paragraph = { type: 'cvparagraph', title: 'Summary', text: 'CV version' };
    const config = { resumeText: 'Resume version' };
    const tex = serializeFilteredSection(paragraph, config);
    expect(tex).toContain('Resume version');
    expect(tex).not.toContain('CV version');
  });

  test('uses original text if no resumeText in config', () => {
    const paragraph = { type: 'cvparagraph', title: 'Summary', text: 'CV version' };
    const config = {};
    const tex = serializeFilteredSection(paragraph, config);
    expect(tex).toContain('CV version');
  });

  test('handles skills filtering', () => {
    const skills = {
      type: 'cvskills',
      title: 'Skills',
      entries: [
        { category: 'Languages', skills: 'Python' },
        { category: 'Quantum', skills: 'Qiskit' },
        { category: 'DevOps', skills: 'Docker' }
      ]
    };
    const config = {
      entries: [
        { resume: true },
        { resume: false },
        { resume: true }
      ]
    };
    const tex = serializeFilteredSection(skills, config);
    expect(tex).toContain('Languages');
    expect(tex).not.toContain('Quantum');
    expect(tex).toContain('DevOps');
  });
});

// ---- serializeDocumentSections ----

describe('serializeDocumentSections', () => {
  const baseTex = [
    '\\documentclass{awesome-cv}',
    '\\input{data.tex}',
    '\\begin{document}',
    '\\input{cv/summary.tex}',
    '\\input{cv/experience.tex}',
    '% \\input{cv/honors.tex}',
    '\\end{document}'
  ].join('\n');

  test('rewrites input lines with new section list', () => {
    const sections = [
      { file: 'cv/experience.tex', enabled: true, comment: '' },
      { file: 'cv/summary.tex', enabled: true, comment: '' },
      { file: 'cv/honors.tex', enabled: false, comment: '' }
    ];
    const result = serializeDocumentSections(baseTex, sections);
    expect(result).toContain('\\input{cv/experience.tex}');
    expect(result).toContain('\\input{cv/summary.tex}');
    expect(result).toContain('% \\input{cv/honors.tex}');
  });

  test('preserves \\input{data.tex}', () => {
    const sections = [{ file: 'cv/experience.tex', enabled: true, comment: '' }];
    const result = serializeDocumentSections(baseTex, sections);
    expect(result).toContain('\\input{data.tex}');
  });

  test('preserves non-input lines', () => {
    const sections = [{ file: 'cv/experience.tex', enabled: true, comment: '' }];
    const result = serializeDocumentSections(baseTex, sections);
    expect(result).toContain('\\documentclass{awesome-cv}');
    expect(result).toContain('\\begin{document}');
    expect(result).toContain('\\end{document}');
  });

  test('includes comments on sections', () => {
    const sections = [
      { file: 'cv/experience.tex', enabled: true, comment: 'done' }
    ];
    const result = serializeDocumentSections(baseTex, sections);
    expect(result).toContain('\\input{cv/experience.tex} % done');
  });
});

// ---- serializeData ----

describe('serializeData', () => {
  const data = {
    personal: {
      firstName: 'John',
      lastName: 'Doe',
      position: 'Engineer',
      address: 'NYC',
      mobile: '555-0100',
      email: 'john@test.com',
      github: 'johndoe',
      linkedin: 'john-doe',
      quote: '',
      photo: { enabled: false, file: 'profile' }
    },
    metrics: [
      { command: 'testVar', label: 'test', value: '42', group: 'Group A' },
      { command: 'emptyVar', label: 'empty desc', value: null, group: 'Group A' },
      { command: 'otherVar', label: 'other', value: 'hello', group: 'Group B' }
    ]
  };

  test('includes personal info commands', () => {
    const tex = serializeData(data);
    expect(tex).toContain('\\name{John}{Doe}');
    expect(tex).toContain('\\position{Engineer}');
    expect(tex).toContain('\\mobile{555-0100}');
    expect(tex).toContain('\\email{john@test.com}');
    expect(tex).toContain('\\github{johndoe}');
    expect(tex).toContain('\\linkedin{john-doe}');
  });

  test('does not include photo when disabled', () => {
    const tex = serializeData(data);
    expect(tex).not.toContain('\\photo');
  });

  test('includes photo when enabled', () => {
    const withPhoto = {
      ...data,
      personal: { ...data.personal, photo: { enabled: true, file: 'myimage' } }
    };
    const tex = serializeData(withPhoto);
    expect(tex).toContain('\\photo[circle,noedge,left]{myimage}');
  });

  test('does not include empty quote', () => {
    const tex = serializeData(data);
    expect(tex).not.toContain('\\quote');
  });

  test('includes quote when non-empty', () => {
    const withQuote = { ...data, personal: { ...data.personal, quote: 'Be curious.' } };
    const tex = serializeData(withQuote);
    expect(tex).toContain("\\quote{``Be curious.''}");
  });

  test('includes metrics with values', () => {
    const tex = serializeData(data);
    expect(tex).toContain('\\providecommand{\\testVar}{42}');
    expect(tex).toContain('\\providecommand{\\otherVar}{hello}');
  });

  test('includes metrics with tbd placeholders for null values', () => {
    const tex = serializeData(data);
    expect(tex).toContain('\\providecommand{\\emptyVar}{\\tbd{empty desc}}');
  });

  test('groups metrics under comment headings', () => {
    const tex = serializeData(data);
    expect(tex).toContain('% Group A');
    expect(tex).toContain('% Group B');
  });

  test('includes tbd command definition', () => {
    const tex = serializeData(data);
    expect(tex).toContain('\\providecommand{\\tbd}');
  });

  test('escapes percent signs in labels', () => {
    const withPercent = {
      ...data,
      metrics: [{ command: 'pctVar', label: 'accuracy %', value: null, group: 'Test' }]
    };
    const tex = serializeData(withPercent);
    expect(tex).toContain('\\tbd{accuracy \\%}');
  });
});

// ---- serializeCoverletter ----

describe('serializeCoverletter', () => {
  const originalTex = [
    '\\documentclass{awesome-cv}',
    '\\input{data.tex}',
    '\\recipient',
    '  {Old Name}',
    '  {Old Address}',
    '\\lettertitle{Old Title}',
    '\\letteropening{Dear Old,}',
    '\\letterclosing{Regards,}',
    '\\letterenclosure[Attached]{Resume}',
    '\\begin{document}',
    '\\begin{cvletter}',
    '\\lettersection{Intro}',
    'Old intro text.',
    '\\end{cvletter}',
    '\\end{document}'
  ].join('\n');

  const newData = {
    recipient: { name: 'New Team', address: 'New City' },
    title: 'New Title',
    opening: 'Dear New,',
    closing: 'Best,',
    enclosure: { label: 'Enclosed', content: 'CV' },
    sections: [
      { title: 'About', body: 'New body text.' },
      { title: 'Why', body: 'Because reasons.' }
    ]
  };

  test('replaces recipient', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('{New Team}');
    expect(result).toContain('{New City}');
    expect(result).not.toContain('Old Name');
  });

  test('replaces title', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\lettertitle{New Title}');
  });

  test('replaces opening', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\letteropening{Dear New,}');
  });

  test('replaces closing', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\letterclosing{Best,}');
  });

  test('replaces enclosure', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\letterenclosure[Enclosed]{CV}');
  });

  test('replaces letter body sections', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\lettersection{About}');
    expect(result).toContain('New body text.');
    expect(result).toContain('\\lettersection{Why}');
    expect(result).toContain('Because reasons.');
    expect(result).not.toContain('Old intro text');
  });

  test('preserves non-letter content', () => {
    const result = serializeCoverletter(originalTex, newData);
    expect(result).toContain('\\documentclass{awesome-cv}');
    expect(result).toContain('\\input{data.tex}');
  });
});
