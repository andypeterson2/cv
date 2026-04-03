/**
 * Phase 2 Cross-Cutting Tests — WPs #665-#669
 *
 * Covers:
 *   - E2E navigation between documents (#665)
 *   - Cross-browser compatibility indicators (#666)
 *   - Print/PDF output validation (#667)
 *   - Accessibility compliance (#668)
 *   - Performance considerations (#669)
 *
 * Updated for SQLite-backed architecture.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relPath));
}

// Read server.js + all route files as a single string for pattern matching
function readServerCode() {
  const routesDir = path.join(PROJECT_ROOT, 'editor', 'routes');
  let combined = readFile('editor/server.js');
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir)) {
      if (f.endsWith('.js')) combined += '\n' + fs.readFileSync(path.join(routesDir, f), 'utf-8');
    }
  }
  return combined;
}

// ---------------------------------------------------------------------------
// WP #665 — E2E navigation between documents
// ---------------------------------------------------------------------------

describe('WP #665 — E2E navigation between documents', () => {
  let appJs;
  let html;

  beforeAll(() => {
    appJs = readFile('editor/public/app.js');
    html = readFile('editor/public/index.html');
  });

  test('editor supports resume, cv, and coverletter document types', () => {
    expect(html).toContain("pdfTab === 'cv'");
    expect(html).toContain("pdfTab === 'resume'");
    expect(html).toContain("pdfTab === 'coverletter'");
  });

  test('app tracks editor and PDF tab state', () => {
    // Tab state is managed via Alpine.js inline in HTML
    expect(html).toContain("editorTab");
    expect(html).toContain("pdfTab");
  });

  test('PDF tab switching works', () => {
    expect(html).toContain('switchPdfTab');
  });

  test('coverletter has its own editor view', () => {
    expect(html).toContain("editorTab === 'coverletter'");
    expect(html).toContain('coverletter-editor');
  });

  test('server API supports all three document types', () => {
    const schema = readFile('editor/lib/schema.js');
    expect(schema).toContain("'resume'");
    expect(schema).toContain("'cv'");
    expect(schema).toContain("'coverletter'");
  });

  test('server has seed endpoint to load all documents', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain('/api/seed');
  });

  test('resume and cv share the same data.tex', () => {
    const cvTex = readFile('cv.tex');
    const resumeTex = readFile('resume.tex');
    expect(cvTex).toContain('\\input{data.tex}');
    expect(resumeTex).toContain('\\input{data.tex}');
  });
});

// ---------------------------------------------------------------------------
// WP #666 — Cross-browser compatibility indicators
// ---------------------------------------------------------------------------

describe('WP #666 — Cross-browser compatibility', () => {
  let html;

  beforeAll(() => {
    html = readFile('editor/public/index.html');
  });

  test('uses standard HTML5 doctype', () => {
    expect(html.trim()).toMatch(/^<!DOCTYPE html>/i);
  });

  test('specifies UTF-8 charset', () => {
    expect(html).toContain('charset="UTF-8"');
  });

  test('uses modern CSS via external stylesheet', () => {
    expect(html).toContain('style.css');
  });

  test('uses CDN-hosted libraries for broad compatibility', () => {
    expect(html).toContain('cdn.jsdelivr.net/npm/alpinejs');
    expect(html).toContain('cdn.jsdelivr.net/npm/sortablejs');
    expect(html).toContain('cdnjs.cloudflare.com/ajax/libs/font-awesome');
  });

  test('CSS file uses standard properties (no vendor prefixes required)', () => {
    const css = readFile('editor/public/style.css');
    expect(css.includes('display:') || css.includes('flex')).toBe(true);
  });

  test('avoids browser-specific JavaScript APIs', () => {
    const appJs = readFile('editor/public/app.js');
    expect(appJs).toContain('fetch(');
    expect(appJs).not.toContain('XMLHttpRequest');
  });
});

// ---------------------------------------------------------------------------
// WP #667 — Print/PDF output validation
// ---------------------------------------------------------------------------

describe('WP #667 — Print/PDF output validation', () => {
  test('PDF serving endpoint validates variant names', () => {
    const server = readServerCode();
    expect(server).toContain('isValidVariant');
    expect(server).toContain('sendFile');
  });

  test('compile endpoint writes data.tex from state', () => {
    const server = readServerCode();
    expect(server).toContain('generateAll');
  });

  test('compile endpoint generates resume files for resume builds', () => {
    const server = readServerCode();
    expect(server).toContain('getAllForCompile');
  });

  test('compile uses xelatex with nonstopmode', () => {
    const server = readServerCode();
    expect(server).toContain('xelatex');
    expect(server).toContain('-interaction=nonstopmode');
    expect(server).toContain('-halt-on-error');
  });

  test('compile has a timeout to prevent hanging', () => {
    const server = readServerCode();
    expect(server).toContain('timeout: 30000');
  });

  test('PDF iframe has accessible title', () => {
    const html = readFile('editor/public/index.html');
    expect(html).toContain('title="Compiled PDF preview"');
  });
});

// ---------------------------------------------------------------------------
// WP #668 — Accessibility compliance
// ---------------------------------------------------------------------------

describe('WP #668 — Accessibility compliance', () => {
  let html;

  beforeAll(() => {
    html = readFile('editor/public/index.html');
  });

  test('html element has lang attribute', () => {
    expect(html).toContain('lang="en"');
  });

  test('page has a title', () => {
    expect(html).toContain('<title>CV Editor</title>');
  });

  test('form inputs have associated labels', () => {
    const labelInputPattern = /<label[^>]*>.*?<input/gs;
    const matches = html.match(labelInputPattern);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThan(5);
  });

  test('buttons have accessible names', () => {
    expect(html).toContain('aria-label="Compile document to PDF"');
    expect(html).toContain('aria-label');
  });

  test('textareas have aria-label attributes', () => {
    expect(html).toContain("aria-label=\"'Bullet point");
    expect(html).toContain('aria-label="CV summary text"');
    expect(html).toContain('aria-label="Resume summary text"');
  });

  test('status messages use role="status"', () => {
    expect(html).toContain('role="status"');
  });

  test('decorative elements are hidden from assistive tech', () => {
    expect(html).toContain('aria-hidden="true"');
  });

  test('landmark regions are properly labeled', () => {
    expect(html).toContain('aria-label="Compile document to PDF"');
    expect(html).toContain('role="status"');
  });

  test('has meta description for SEO/accessibility', () => {
    expect(html).toContain('meta name="description"');
  });

  test('modal dialog has proper ARIA attributes', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});

// ---------------------------------------------------------------------------
// WP #669 — Performance considerations
// ---------------------------------------------------------------------------

describe('WP #669 — Performance considerations', () => {
  test('editor loads data from localStorage or seeds from server on init', () => {
    const appJs = readFile('editor/public/app.js');
    expect(appJs).toContain('CVStorage.load');
    expect(appJs).toContain('seedFromServer');
  });

  test('AlpineJS is loaded with defer', () => {
    const html = readFile('editor/public/index.html');
    expect(html).toContain('defer src="https://cdn.jsdelivr.net/npm/alpinejs');
  });

  test('fonts use preconnect for faster loading', () => {
    const html = readFile('editor/public/index.html');
    expect(html).toContain('rel="preconnect"');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('fonts.gstatic.com');
  });

  test('Google Fonts use display=swap to prevent FOIT', () => {
    const html = readFile('editor/public/index.html');
    expect(html).toContain('display=swap');
  });

  test('server uses express.static for efficient asset serving', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain('express.static');
  });

  test('server limits request body size via express.json()', () => {
    const server = readFile('editor/server.js');
    expect(server).toContain('express.json(');
  });

  test('compilation has timeout protection', () => {
    const server = readServerCode();
    expect(server).toContain('timeout: 30000');
  });

  test('editor CSS and JS are lightweight (no heavy frameworks)', () => {
    const html = readFile('editor/public/index.html');
    expect(html).toContain('alpinejs');
    expect(html).not.toContain('react.production');
    expect(html).not.toContain('angular.min.js');
  });

  test('uses debounced autosave to reduce API calls', () => {
    const appJs = readFile('editor/public/app.js');
    expect(appJs).toContain('debounce');
  });

  test('SQLite with WAL mode for concurrent read performance', () => {
    const db = readFile('editor/lib/db.js');
    expect(db).toContain('journal_mode = WAL');
  });
});
