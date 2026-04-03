const {
  generateDataTex,
  generateSectionTex,
  generateDocumentTex,
  generateCoverletterTex,
  generateAll,
} = require('../../lib/generator');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// generateDataTex
// ---------------------------------------------------------------------------

describe('generateDataTex', () => {
  it('generates personal info commands', () => {
    const personal = {
      firstName: 'Andrew',
      lastName: 'Peterson',
      position: 'Software Engineer',
      address: 'San Diego, CA',
      mobile: '555-1234',
      email: 'test@example.com',
      github: 'andrewp',
      linkedin: 'andrewp',
      homepage: 'example.com',
      quote: 'Hello world',
    };
    const tex = generateDataTex(personal);
    expect(tex).toContain('\\name{Andrew}{Peterson}');
    expect(tex).toContain('\\position{Software Engineer}');
    expect(tex).toContain('\\address{San Diego, CA}');
    expect(tex).toContain('\\mobile{555-1234}');
    expect(tex).toContain('\\email{test@example.com}');
    expect(tex).toContain('\\github{andrewp}');
    expect(tex).toContain('\\linkedin{andrewp}');
    expect(tex).toContain('\\homepage{example.com}');
    // Serializer wraps quotes in LaTeX smart quotes
    expect(tex).toContain('Hello world');
  });

  it('handles empty personal fields gracefully', () => {
    const personal = {};
    const tex = generateDataTex(personal);
    expect(tex).toContain('\\name{}{}');
    // Serializer omits empty fields, but name is always present
    expect(typeof tex).toBe('string');
  });

  it('handles photo enabled', () => {
    const personal = {
      photoEnabled: '1',
      photoFile: 'myprofile',
    };
    const tex = generateDataTex(personal);
    expect(tex).toContain('myprofile');
  });

  it('handles photo disabled', () => {
    const personal = { photoEnabled: '0' };
    const tex = generateDataTex(personal);
    // Should not error
    expect(typeof tex).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// generateSectionTex
// ---------------------------------------------------------------------------

describe('generateSectionTex', () => {
  it('generates cventries section', () => {
    const section = {
      type: 'cventries',
      title: 'Experience',
      entries: [
        {
          fields: {
            position: 'Engineer',
            organization: 'Acme',
            location: 'NYC',
            date: '2020-2023',
          },
          items: [{ content: 'Built things' }, { content: 'Fixed bugs' }],
        },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{Experience}');
    expect(tex).toContain('\\begin{cventries}');
    expect(tex).toContain('{Engineer}');
    expect(tex).toContain('{Acme}');
    expect(tex).toContain('{NYC}');
    expect(tex).toContain('{2020-2023}');
    expect(tex).toContain('\\item {Built things}');
    expect(tex).toContain('\\item {Fixed bugs}');
    expect(tex).toContain('\\end{cventries}');
  });

  it('generates cvskills section', () => {
    const section = {
      type: 'cvskills',
      title: 'Skills',
      entries: [
        { fields: { category: 'Languages', skills: 'JavaScript, Python' } },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{Skills}');
    expect(tex).toContain('{Languages}');
    expect(tex).toContain('{JavaScript, Python}');
  });

  it('generates cvhonors section', () => {
    const section = {
      type: 'cvhonors',
      title: 'Awards',
      entries: [
        { fields: { award: 'Best Paper', issuer: 'IEEE', location: 'NYC', date: '2023' } },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{Awards}');
    expect(tex).toContain('{Best Paper}');
    expect(tex).toContain('{IEEE}');
  });

  it('generates cvreferences section', () => {
    const section = {
      type: 'cvreferences',
      title: 'References',
      entries: [
        { fields: { name: 'Dr. Smith', relation: 'Advisor', phone: '555-0000', email: 'smith@uni.edu' } },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{References}');
    expect(tex).toContain('{Dr. Smith}');
  });

  it('generates cvparagraph section', () => {
    const section = {
      type: 'cvparagraph',
      title: 'Summary',
      entries: [
        { fields: { text: 'I am a great engineer.' } },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{Summary}');
    expect(tex).toContain('I am a great engineer.');
  });

  it('handles cvparagraph with no entries', () => {
    const section = {
      type: 'cvparagraph',
      title: 'Summary',
      entries: [],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\cvsection{Summary}');
  });

  it('handles cventries with no items', () => {
    const section = {
      type: 'cventries',
      title: 'Experience',
      entries: [
        {
          fields: {
            position: 'Engineer',
            organization: 'Acme',
            location: 'NYC',
            date: '2020',
          },
        },
      ],
    };
    const tex = generateSectionTex(section);
    expect(tex).toContain('\\begin{cventries}');
    expect(tex).toContain('{Engineer}');
    // Should not crash
  });
});

// ---------------------------------------------------------------------------
// generateDocumentTex
// ---------------------------------------------------------------------------

describe('generateDocumentTex', () => {
  it('generates document with section inputs', () => {
    const tex = generateDocumentTex('cv', ['experience.tex', 'skills.tex']);
    expect(tex).toContain('\\documentclass[11pt, letterpaper]{awesome-cv}');
    expect(tex).toContain('\\input{data.tex}');
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\input{experience.tex}');
    expect(tex).toContain('\\input{skills.tex}');
    expect(tex).toContain('\\end{document}');
  });

  it('generates document with no sections', () => {
    const tex = generateDocumentTex('resume', []);
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\end{document}');
    expect(tex).not.toContain('\\input{undefined}');
  });

  it('includes preamble configuration', () => {
    const tex = generateDocumentTex('cv', []);
    expect(tex).toContain('\\colorlet{awesome}{spinel}');
    expect(tex).toContain('\\setbool{acvSectionColorHighlight}{true}');
    expect(tex).toContain('\\makecvheader');
    expect(tex).toContain('\\makecvfooter');
  });
});

// ---------------------------------------------------------------------------
// generateCoverletterTex
// ---------------------------------------------------------------------------

describe('generateCoverletterTex', () => {
  const personal = { firstName: 'Andrew', lastName: 'Peterson' };
  const coverletter = {
    recipientName: 'Hiring Team',
    recipientAddress: '123 Main St',
    title: 'Application for Engineer',
    opening: 'Dear Hiring Team,',
    closing: 'Sincerely,',
    enclosureLabel: 'Attached',
    enclosureContent: 'Curriculum Vitae',
    sections: [
      { title: 'About Me', body: 'I am a software engineer.' },
      { title: 'Why Me?', body: 'I bring deep expertise.' },
    ],
  };

  it('generates cover letter with all fields', () => {
    const tex = generateCoverletterTex(personal, coverletter);
    expect(tex).toContain('\\documentclass[11pt, letterpaper]{awesome-cv}');
    expect(tex).toContain('\\input{data.tex}');
    expect(tex).toContain('{Hiring Team}');
    expect(tex).toContain('{123 Main St}');
    expect(tex).toContain('\\lettertitle{Application for Engineer}');
    expect(tex).toContain('\\letteropening{Dear Hiring Team,}');
    expect(tex).toContain('\\letterclosing{Sincerely,}');
    expect(tex).toContain('\\letterenclosure[Attached]{Curriculum Vitae}');
    expect(tex).toContain('\\begin{cvletter}');
    expect(tex).toContain('\\lettersection{About Me}');
    expect(tex).toContain('I am a software engineer.');
    expect(tex).toContain('\\lettersection{Why Me?}');
    expect(tex).toContain('I bring deep expertise.');
    expect(tex).toContain('\\makeletterclosing');
    expect(tex).toContain('\\end{document}');
  });

  it('includes personal name in footer', () => {
    const tex = generateCoverletterTex(personal, coverletter);
    expect(tex).toContain('Andrew Peterson');
    expect(tex).toContain('Cover Letter');
  });

  it('handles empty coverletter fields', () => {
    const tex = generateCoverletterTex({}, {});
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\end{document}');
    // No sections in body
    expect(tex).not.toContain('\\lettersection');
  });

  it('handles coverletter with no sections', () => {
    const tex = generateCoverletterTex(personal, { sections: [] });
    expect(tex).toContain('\\begin{cvletter}');
    expect(tex).toContain('\\end{cvletter}');
    expect(tex).not.toContain('\\lettersection');
  });
});

// ---------------------------------------------------------------------------
// generateAll
// ---------------------------------------------------------------------------

describe('generateAll', () => {
  let buildDir;
  let templatesDir;
  let assetsDir;

  beforeEach(() => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-build-'));
    templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-templates-'));
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-assets-'));
    // Create a fake awesome-cv.cls
    fs.writeFileSync(path.join(templatesDir, 'awesome-cv.cls'), '% fake cls', 'utf-8');
    // Create a fake asset
    fs.writeFileSync(path.join(assetsDir, 'profile.jpg'), 'fakejpg', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(templatesDir, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  const baseCompileData = {
    personal: { firstName: 'Andrew', lastName: 'Peterson' },
    sections: [
      {
        id: 'experience',
        type: 'cventries',
        title: 'Experience',
        entries: [
          {
            fields: { position: 'Dev', organization: 'Co', location: 'LA', date: '2024' },
            items: [{ content: 'Did stuff' }],
          },
        ],
      },
      {
        id: 'skills',
        type: 'cvskills',
        title: 'Skills',
        entries: [
          { fields: { category: 'Languages', skills: 'JS' } },
        ],
      },
    ],
    coverletter: null,
    variant: 'cv',
  };

  it('writes data.tex to build directory', () => {
    generateAll(baseCompileData, buildDir, templatesDir, assetsDir);
    expect(fs.existsSync(path.join(buildDir, 'data.tex'))).toBe(true);
    const content = fs.readFileSync(path.join(buildDir, 'data.tex'), 'utf-8');
    expect(content).toContain('\\name{Andrew}{Peterson}');
  });

  it('writes section .tex files', () => {
    generateAll(baseCompileData, buildDir, templatesDir, assetsDir);
    expect(fs.existsSync(path.join(buildDir, 'experience.tex'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'skills.tex'))).toBe(true);
  });

  it('writes main document .tex', () => {
    const mainFile = generateAll(baseCompileData, buildDir, templatesDir, assetsDir);
    expect(mainFile).toBe(path.join(buildDir, 'cv.tex'));
    expect(fs.existsSync(mainFile)).toBe(true);
    const content = fs.readFileSync(mainFile, 'utf-8');
    expect(content).toContain('\\input{experience.tex}');
    expect(content).toContain('\\input{skills.tex}');
  });

  it('copies awesome-cv.cls', () => {
    generateAll(baseCompileData, buildDir, templatesDir, assetsDir);
    expect(fs.existsSync(path.join(buildDir, 'awesome-cv.cls'))).toBe(true);
  });

  it('copies assets', () => {
    generateAll(baseCompileData, buildDir, templatesDir, assetsDir);
    expect(fs.existsSync(path.join(buildDir, 'assets', 'profile.jpg'))).toBe(true);
  });

  it('generates coverletter variant', () => {
    const clData = {
      personal: { firstName: 'Andrew', lastName: 'Peterson' },
        sections: [],
      coverletter: {
        recipientName: 'HR',
        recipientAddress: '123 St',
        title: 'App',
        opening: 'Dear HR,',
        closing: 'Best,',
        enclosureLabel: 'Attached',
        enclosureContent: 'Resume',
        sections: [{ title: 'Intro', body: 'Hello.' }],
      },
      variant: 'coverletter',
    };
    const mainFile = generateAll(clData, buildDir, templatesDir, assetsDir);
    expect(mainFile).toBe(path.join(buildDir, 'coverletter.tex'));
    const content = fs.readFileSync(mainFile, 'utf-8');
    expect(content).toContain('\\lettersection{Intro}');
  });

  it('returns correct path for resume variant', () => {
    const resumeData = { ...baseCompileData, variant: 'resume' };
    const mainFile = generateAll(resumeData, buildDir, templatesDir, assetsDir);
    expect(mainFile).toBe(path.join(buildDir, 'resume.tex'));
  });

  it('handles missing templates dir gracefully', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-empty-'));
    // No awesome-cv.cls — should not throw
    generateAll(baseCompileData, buildDir, emptyDir, null);
    expect(fs.existsSync(path.join(buildDir, 'data.tex'))).toBe(true);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
