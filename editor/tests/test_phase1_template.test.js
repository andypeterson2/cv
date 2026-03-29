/**
 * Phase 1 Template Tests — WPs #670-#679
 *
 * Covers:
 *   - Responsive layout and interactive elements (index.html / editor UI)
 *   - LaTeX template structure, formatting
 *   - ATS parsing readiness
 *   - UI-kit rendering and web editor save/preview
 *
 * Updated for SQLite-backed architecture.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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

  test('has a document selector with cv, resume, and coverletter options', () => {
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

  test('has autosave functionality (no manual save button needed)', () => {
    // New architecture uses debounced autosave instead of manual save buttons
    const appJs = readFile('editor/public/app.js');
    expect(appJs).toContain('autoSaveEntry');
    expect(appJs).toContain('autoSaveItem');
    expect(appJs).toContain('debounce');
  });

  test('has add/remove entry buttons', () => {
    expect(html).toContain('+ Add Entry');
    expect(html).toContain('+ Add Bullet');
    expect(html).toContain('Remove');
  });

  test('has resume toggle checkboxes per entry and item', () => {
    expect(html).toContain('toggleResumeEntry');
    expect(html).toContain('toggleResumeItem');
  });

  test('has collapsible sidebar', () => {
    expect(html).toContain('sidebarOpen');
    expect(html).toContain('collapsible');
  });

  test('has sortable section list (drag-and-drop)', () => {
    expect(html).toContain('sortablejs');
    expect(html).toContain('ui-drag-handle');
  });

  test('uses modal dialogs instead of prompt()', () => {
    expect(html).toContain('modal-overlay');
    expect(html).toContain('modal-dialog');
    expect(html).toContain('submitModal');
    expect(html).toContain('cancelModal');
    // Should NOT use prompt()
    const appJs = readFile('editor/public/app.js');
    expect(appJs).not.toContain('prompt(');
  });
});

// ---------------------------------------------------------------------------
// WP #672 — Content accuracy: SQLite database
// ---------------------------------------------------------------------------

describe('WP #672 — Content stored in SQLite database', () => {
  test('migration file exists with proper schema', () => {
    const sql = readFile('editor/migrations/001_initial.sql');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('settings');
    expect(sql).toContain('sections');
    expect(sql).toContain('entries');
    expect(sql).toContain('items');
    expect(sql).toContain('metrics');
  });

  test('database access layer exists', () => {
    expect(fileExists('editor/lib/db.js')).toBe(true);
    const db = readFile('editor/lib/db.js');
    expect(db).toContain('class CvDatabase');
    expect(db).toContain('getSettings');
    expect(db).toContain('getSections');
    expect(db).toContain('getAllForCompile');
  });

  test('migration script exists', () => {
    expect(fileExists('migrate.cjs')).toBe(true);
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

  test('awesome-cv.cls class file exists', () => {
    expect(fileExists('awesome-cv.cls')).toBe(true);
  });

  test('awesome-cv.cls also exists in templates/', () => {
    expect(fileExists('templates/awesome-cv.cls')).toBe(true);
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

  test('defines metric commands', () => {
    expect(dataTex.includes('\\newcommand') || dataTex.includes('\\providecommand')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WP #676 — ATS parsing readiness
// ---------------------------------------------------------------------------

describe('WP #676 — ATS parsing readiness', () => {
  test('cv.tex uses standard geometry margins', () => {
    const tex = readFile('cv.tex');
    expect(tex).toContain('\\geometry{');
  });

  test('resume does not use multi-column layout in content', () => {
    const tex = readFile('resume.tex');
    expect(tex).not.toContain('\\begin{multicols}');
  });
});

// ---------------------------------------------------------------------------
// WP #677 — One-page constraint for resume
// ---------------------------------------------------------------------------

describe('WP #677 — One-page constraint for resume', () => {
  test('resume.tex does not include too many sections', () => {
    const tex = readFile('resume.tex');
    const inputLines = tex.match(/^\\input{resume\//gm) || [];
    expect(inputLines.length).toBeLessThanOrEqual(8);
  });

  test('resume margins are tight for space efficiency', () => {
    const tex = readFile('resume.tex');
    const geometryMatch = tex.match(/\\geometry\{([^}]+)\}/);
    expect(geometryMatch).not.toBeNull();
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

  test('has granular API save functionality', () => {
    expect(appJs).toContain('autoSavePersonal');
    expect(appJs).toContain('autoSaveEntry');
    expect(appJs).toContain('autoSaveItem');
    expect(appJs).toContain("method: 'PATCH'");
    expect(appJs).toContain("method: 'PUT'");
  });

  test('has section data loading', () => {
    expect(appJs).toContain('loadSectionData');
    expect(appJs).toContain('loadDocumentSections');
  });

  test('has compile functionality', () => {
    expect(appJs).toContain('compile');
    expect(appJs).toContain('compiling');
  });

  test('has document switching', () => {
    expect(appJs).toContain('activeDoc');
    expect(appJs).toContain('switchDoc');
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

  test('server has RESTful API routes', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain("app.get('/api/settings'");
    expect(server).toContain("app.patch('/api/settings'");
    expect(server).toContain("app.get('/api/sections'");
    expect(server).toContain("app.post('/api/sections'");
    expect(server).toContain("app.post('/api/compile/");
    expect(server).toContain("app.get('/api/pdf/");
    expect(server).toContain("app.get('/api/metrics'");
    expect(server).toContain("app.get('/api/export'");
  });

  test('server uses SQLite database', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain('CvDatabase');
    expect(server).toContain('getDb()');
  });

  test('API validation via ajv schemas', () => {
    expect(fileExists('editor/lib/schema.js')).toBe(true);
    const server = readFile('editor/server.js');
    expect(server).toContain('validate(');
  });
});
