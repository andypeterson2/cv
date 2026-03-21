/**
 * Phase 1 Template Tests — WPs #670-#679
 *
 * Covers:
 *   - Responsive layout and interactive elements (index.html / editor UI)
 *   - Content accuracy (data.json, resume-config.json)
 *   - LaTeX template structure, variable substitution, formatting
 *   - ATS parsing readiness
 *   - One-page constraint for resume
 *   - UI-kit rendering and web editor save/preview
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const EDITOR_ROOT = path.join(PROJECT_ROOT, 'editor');

// Helper: read a project file
function readFile(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// WP #670 — Responsive layout: HTML structure
// ---------------------------------------------------------------------------

describe('WP #670 — Responsive layout and HTML structure', () => {
  let html;

  beforeAll(() => {
    html = readFile('editor/public/index.html');
  });

  test('contains viewport meta tag for responsive design', () => {
    expect(html).toContain('viewport');
    expect(html).toContain('width=device-width');
  });

  test('has semantic landmark elements', () => {
    expect(html).toContain('<header');
    expect(html).toContain('<main');
    expect(html).toContain('<aside');
  });

  test('uses role attributes for accessibility', () => {
    expect(html).toContain('role="banner"');
    expect(html).toContain('role="main"');
    expect(html).toContain('role="status"');
  });

  test('includes aria-label attributes on interactive elements', () => {
    expect(html).toContain('aria-label="Active document"');
    expect(html).toContain('aria-label="Compile document to PDF"');
    expect(html).toContain('aria-label="Toggle PDF preview"');
  });

  test('has a document selector with resume, cv, and coverletter options', () => {
    expect(html).toContain('<option value="resume">');
    expect(html).toContain('<option value="cv">');
    expect(html).toContain('<option value="coverletter">');
  });
});

// ---------------------------------------------------------------------------
// WP #671 — Interactive elements: editor UI controls
// ---------------------------------------------------------------------------

describe('WP #671 — Interactive elements in editor UI', () => {
  let html;

  beforeAll(() => {
    html = readFile('editor/public/index.html');
  });

  test('has compile button', () => {
    expect(html).toContain('Compile');
    expect(html).toContain('@click="compile()"');
  });

  test('has theme toggle button', () => {
    expect(html).toContain('toggleTheme()');
  });

  test('has PDF preview toggle', () => {
    expect(html).toContain('showPdf');
    expect(html).toContain('pdf-iframe');
  });

  test('has save section button', () => {
    expect(html).toContain('saveSection');
  });

  test('has add/remove entry buttons', () => {
    expect(html).toContain('+ Add Entry');
    expect(html).toContain('+ Add Bullet');
    expect(html).toContain('Remove');
  });

  test('has resume toggle checkboxes per section and entry', () => {
    expect(html).toContain('toggleResumeSection');
    expect(html).toContain('toggleResumeEntry');
    expect(html).toContain('toggleResumeBullet');
  });

  test('has collapsible sidebar', () => {
    expect(html).toContain('sidebarOpen');
    expect(html).toContain('collapsible');
  });

  test('has sortable section list (drag-and-drop)', () => {
    expect(html).toContain('sortablejs');
    expect(html).toContain('ui-drag-handle');
  });
});

// ---------------------------------------------------------------------------
// WP #672 — Content accuracy: data.json
// ---------------------------------------------------------------------------

describe('WP #672 — Content accuracy in data.json', () => {
  let data;

  beforeAll(() => {
    data = JSON.parse(readFile('data.json'));
  });

  test('has personal information', () => {
    expect(data.personal).toBeDefined();
    expect(data.personal.firstName).toBeTruthy();
    expect(data.personal.lastName).toBeTruthy();
    expect(data.personal.email).toBeTruthy();
  });

  test('personal info contains valid email format', () => {
    expect(data.personal.email).toMatch(/@/);
  });

  test('personal info contains valid phone number', () => {
    expect(data.personal.mobile).toMatch(/\d{3}/);
  });

  test('has GitHub and LinkedIn identifiers', () => {
    expect(data.personal.github).toBeTruthy();
    expect(data.personal.linkedin).toBeTruthy();
  });

  test('has metrics array with entries', () => {
    expect(Array.isArray(data.metrics)).toBe(true);
    expect(data.metrics.length).toBeGreaterThan(0);
  });

  test('each metric has required fields', () => {
    for (const m of data.metrics) {
      expect(m).toHaveProperty('command');
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('group');
      expect(m).toHaveProperty('value');
      expect(m).toHaveProperty('section');
    }
  });

  test('metric commands are unique', () => {
    const commands = data.metrics.map(m => m.command);
    const unique = new Set(commands);
    expect(unique.size).toBe(commands.length);
  });

  test('metric sections reference valid .tex files', () => {
    for (const m of data.metrics) {
      expect(m.section).toMatch(/\.tex$/);
      expect(fileExists(m.section)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// WP #673 — Resume config structure
// ---------------------------------------------------------------------------

describe('WP #673 — Resume config structure and integrity', () => {
  let config;

  beforeAll(() => {
    config = JSON.parse(readFile('resume-config.json'));
  });

  test('has sectionOrder array', () => {
    expect(Array.isArray(config.sectionOrder)).toBe(true);
    expect(config.sectionOrder.length).toBeGreaterThan(0);
  });

  test('sectionOrder references real .tex files', () => {
    for (const file of config.sectionOrder) {
      expect(fileExists(file)).toBe(true);
    }
  });

  test('has sections object', () => {
    expect(typeof config.sections).toBe('object');
  });

  test('each section in sectionOrder has a config entry', () => {
    for (const file of config.sectionOrder) {
      expect(config.sections[file]).toBeDefined();
    }
  });

  test('section configs have resume boolean', () => {
    for (const [, sec] of Object.entries(config.sections)) {
      expect(typeof sec.resume).toBe('boolean');
    }
  });

  test('section configs with entries have per-entry resume flags', () => {
    for (const [, sec] of Object.entries(config.sections)) {
      if (sec.entries) {
        expect(Array.isArray(sec.entries)).toBe(true);
        for (const entry of sec.entries) {
          expect(typeof entry.resume).toBe('boolean');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WP #674 — LaTeX template structure
// ---------------------------------------------------------------------------

describe('WP #674 — LaTeX template structure', () => {
  test('cv.tex exists and has correct document class', () => {
    const tex = readFile('cv.tex');
    expect(tex).toContain('\\documentclass');
    expect(tex).toContain('awesome-cv');
  });

  test('resume.tex exists and has correct document class', () => {
    const tex = readFile('resume.tex');
    expect(tex).toContain('\\documentclass');
    expect(tex).toContain('awesome-cv');
  });

  test('both documents use letterpaper', () => {
    expect(readFile('cv.tex')).toContain('letterpaper');
    expect(readFile('resume.tex')).toContain('letterpaper');
  });

  test('both documents input data.tex for shared variables', () => {
    expect(readFile('cv.tex')).toContain('\\input{data.tex}');
    expect(readFile('resume.tex')).toContain('\\input{data.tex}');
  });

  test('cv.tex inputs cv/ section files', () => {
    const tex = readFile('cv.tex');
    expect(tex).toContain('\\input{cv/experience.tex}');
    expect(tex).toContain('\\input{cv/education.tex}');
    expect(tex).toContain('\\input{cv/skills.tex}');
  });

  test('resume.tex inputs resume/ section files', () => {
    const tex = readFile('resume.tex');
    expect(tex).toContain('\\input{resume/');
  });

  test('awesome-cv.cls class file exists', () => {
    expect(fileExists('awesome-cv.cls')).toBe(true);
  });

  test('coverletter.tex exists', () => {
    expect(fileExists('coverletter.tex')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WP #675 — Variable substitution in data.tex
// ---------------------------------------------------------------------------

describe('WP #675 — Variable substitution in data.tex', () => {
  let dataTex;

  beforeAll(() => {
    dataTex = readFile('data.tex');
  });

  test('data.tex exists', () => {
    expect(dataTex.length).toBeGreaterThan(0);
  });

  test('defines personal info commands', () => {
    expect(dataTex).toContain('\\name');
    expect(dataTex).toContain('\\position');
    expect(dataTex).toContain('\\email');
  });

  test('defines metric newcommands', () => {
    // Metrics from data.json should become \\newcommand entries
    expect(dataTex).toContain('\\newcommand');
  });

  test('data.json metrics match data.tex commands', () => {
    const data = JSON.parse(readFile('data.json'));
    for (const m of data.metrics) {
      // Each metric command should be defined in data.tex
      expect(dataTex).toContain(m.command);
    }
  });
});

// ---------------------------------------------------------------------------
// WP #676 — ATS parsing readiness
// ---------------------------------------------------------------------------

describe('WP #676 — ATS parsing readiness', () => {
  test('resume uses standard section headings', () => {
    // Verify sections use recognizable titles for ATS
    const config = JSON.parse(readFile('resume-config.json'));
    const sectionFiles = config.sectionOrder;

    const expectedSections = ['experience', 'education', 'skills'];
    for (const expected of expectedSections) {
      const found = sectionFiles.some(f => f.toLowerCase().includes(expected));
      expect(found).toBe(true);
    }
  });

  test('cv.tex uses standard geometry margins', () => {
    const tex = readFile('cv.tex');
    expect(tex).toContain('\\geometry{');
  });

  test('resume does not use multi-column layout in content', () => {
    // Multi-column layouts can confuse ATS parsers
    const tex = readFile('resume.tex');
    expect(tex).not.toContain('\\begin{multicols}');
  });

  test('no images embedded in resume content sections', () => {
    // ATS parsers cannot read images; only the optional header photo should exist
    const resumeDir = path.join(PROJECT_ROOT, 'resume');
    if (fs.existsSync(resumeDir)) {
      const files = fs.readdirSync(resumeDir).filter(f => f.endsWith('.tex'));
      for (const f of files) {
        const content = fs.readFileSync(path.join(resumeDir, f), 'utf-8');
        expect(content).not.toContain('\\includegraphics');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WP #677 — One-page constraint for resume
// ---------------------------------------------------------------------------

describe('WP #677 — One-page constraint for resume', () => {
  test('resume.tex does not include too many sections', () => {
    const tex = readFile('resume.tex');
    const inputLines = tex.match(/^\\input{resume\//gm) || [];
    // A one-page resume should have at most ~8 sections
    expect(inputLines.length).toBeLessThanOrEqual(8);
  });

  test('resume-config filters entries to reduce content', () => {
    const config = JSON.parse(readFile('resume-config.json'));
    let hasFiltering = false;
    for (const [, sec] of Object.entries(config.sections)) {
      if (sec.resume === false) {
        hasFiltering = true;
        break;
      }
      if (sec.entries) {
        for (const entry of sec.entries) {
          if (entry.resume === false) {
            hasFiltering = true;
            break;
          }
        }
      }
    }
    expect(hasFiltering).toBe(true);
  });

  test('resume margins are tight for space efficiency', () => {
    const tex = readFile('resume.tex');
    const geometryMatch = tex.match(/\\geometry\{([^}]+)\}/);
    expect(geometryMatch).not.toBeNull();
    // Margins should be specified (not default wide margins)
    expect(geometryMatch[1]).toContain('cm');
  });
});

// ---------------------------------------------------------------------------
// WP #678 — UI-kit rendering
// ---------------------------------------------------------------------------

describe('WP #678 — UI-kit rendering', () => {
  let html;

  beforeAll(() => {
    html = readFile('editor/public/index.html');
  });

  test('loads ui-kit CSS', () => {
    expect(html).toContain('ui-kit.css');
  });

  test('loads ui-kit JavaScript', () => {
    expect(html).toContain('ui-kit.js');
  });

  test('loads theme-bootstrap.js', () => {
    expect(html).toContain('theme-bootstrap.js');
  });

  test('loads service-config.js for backend URL resolution', () => {
    expect(html).toContain('service-config.js');
  });

  test('uses ui-kit CSS classes', () => {
    expect(html).toContain('ui-scrollbar-thin');
    expect(html).toContain('ui-alert');
    expect(html).toContain('ui-badge');
    expect(html).toContain('ui-drag-handle');
  });

  test('initializes UIKit connect widget', () => {
    expect(html).toContain('UIKit.initConnect');
    expect(html).toContain("service: 'cv'");
  });

  test('loads icons.js', () => {
    expect(html).toContain('icons.js');
  });
});

// ---------------------------------------------------------------------------
// WP #679 — Web editor save/preview
// ---------------------------------------------------------------------------

describe('WP #679 — Web editor save/preview', () => {
  let appJs;

  beforeAll(() => {
    appJs = readFile('editor/public/app.js');
  });

  test('app.js defines main app function', () => {
    expect(appJs).toContain('function app()');
  });

  test('has data save functionality', () => {
    expect(appJs).toContain('saveData');
    expect(appJs).toContain("method: 'PUT'");
  });

  test('has section load and save functionality', () => {
    expect(appJs).toContain('loadSectionData') || expect(appJs).toContain('saveSection');
  });

  test('has compile functionality', () => {
    expect(appJs).toContain('compile');
    expect(appJs).toContain('compiling');
  });

  test('has document switching', () => {
    expect(appJs).toContain('activeDoc');
  });

  test('has theme toggle support', () => {
    expect(appJs).toContain('toggleTheme');
    expect(appJs).toContain('darkMode');
  });

  test('has PDF preview state management', () => {
    expect(appJs).toContain('showPdf');
    expect(appJs).toContain('pdfUrl');
    expect(appJs).toContain('compiledPdfs');
  });

  test('server exports app for testing', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain('module.exports');
    expect(server).toContain('require.main === module');
  });

  test('server has API routes for CRUD operations', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain("app.get('/api/data'");
    expect(server).toContain("app.put('/api/data'");
    expect(server).toContain("app.get('/api/section/");
    expect(server).toContain("app.put('/api/section/");
    expect(server).toContain("app.post('/api/compile/");
    expect(server).toContain("app.get('/api/pdf/");
  });
});
