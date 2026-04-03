/**
 * DOM test setup — provides fetch mocking and helpers for Alpine.js testing.
 *
 * Since Alpine.js requires a real browser-like environment and CDN loading,
 * we test the app.js logic by evaluating it directly and verifying the
 * returned object's behavior against mocked fetch responses.
 */

import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', '..', 'public', 'app.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');

// Default fixture data
export const fixtures = {
  personal: {
    'personal.firstName': 'Andrew',
    'personal.lastName': 'Peterson',
    'personal.position': 'Software Engineer',
    'personal.email': 'test@example.com',
    'personal.github': 'andrewp',
    'personal.linkedin': 'andrewp',
    'personal.mobile': '555-1234',
    'personal.address': 'San Diego, CA',
    'personal.quote': '',
    'personal.photoEnabled': '0',
  },
  sections: [
    { id: 'experience', type: 'cventries', title: 'Experience' },
    { id: 'skills', type: 'cvskills', title: 'Skills' },
    { id: 'summary', type: 'cvparagraph', title: 'Summary' },
  ],
  experience: {
    id: 'experience',
    type: 'cventries',
    title: 'Experience',
    entries: [
      {
        id: 1,
        section_id: 'experience',
        sort_order: 0,
        fields: { position: 'Engineer', organization: 'Acme', location: 'NYC', date: '2024' },
        resumeIncluded: true,
        items: [
          { id: 10, entry_id: 1, sort_order: 0, content: 'Built systems', resumeIncluded: true },
          { id: 11, entry_id: 1, sort_order: 1, content: 'Led team', resumeIncluded: true },
        ],
      },
      {
        id: 2,
        section_id: 'experience',
        sort_order: 1,
        fields: { position: 'Intern', organization: 'Startup', location: 'Remote', date: '2023' },
        resumeIncluded: false,
        items: [
          { id: 12, entry_id: 2, sort_order: 0, content: 'Developed APIs', resumeIncluded: true },
        ],
      },
    ],
  },
  skills: {
    id: 'skills',
    type: 'cvskills',
    title: 'Skills',
    entries: [
      { id: 3, section_id: 'skills', sort_order: 0, fields: { category: 'Languages', skills: 'JS, Python' }, resumeIncluded: true, items: [] },
    ],
  },
  summary: {
    id: 'summary',
    type: 'cvparagraph',
    title: 'Summary',
    entries: [
      { id: 4, section_id: 'summary', sort_order: 0, fields: { text: 'Experienced engineer.' }, resumeIncluded: true, items: [] },
    ],
  },
  documentSections: {
    variant: 'cv',
    sections: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: null },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 2, resumeParagraphText: null },
    ],
  },
  coverletterSettings: {
    'coverletter.recipientName': 'HR Team',
    'coverletter.recipientAddress': '123 Main St',
    'coverletter.title': 'Application',
    'coverletter.opening': 'Dear Team,',
    'coverletter.closing': 'Sincerely,',
    'coverletter.enclosureLabel': 'Attached',
    'coverletter.enclosureContent': 'Resume',
  },
  coverletterSections: [
    { id: 1, sort_order: 0, title: 'About Me', body: 'I am a software engineer.' },
    { id: 2, sort_order: 1, title: 'Why Me?', body: 'I bring deep expertise.' },
  ],
};

/**
 * Sets up global.fetch mock that returns fixture data based on URL patterns.
 * Returns an object with the mock and helper to check calls.
 */
export function setupFetchMock(overrides = {}) {
  const responses = { ...fixtures, ...overrides };
  const fetchMock = vi.fn(async (url, options = {}) => {
    const urlStr = String(url);

    // Settings
    if (urlStr.includes('/api/settings') && !options.method) {
      if (urlStr.includes('prefix=personal')) {
        return mockResponse(responses.personal);
      }
      if (urlStr.includes('prefix=coverletter')) {
        return mockResponse(responses.coverletterSettings);
      }
      return mockResponse({ ...responses.personal, ...responses.coverletterSettings });
    }
    if (urlStr.includes('/api/settings') && options.method === 'PATCH') {
      return mockResponse({ success: true });
    }

    // Sections list
    if (urlStr.match(/\/api\/sections$/) && !options.method) {
      return mockResponse(responses.sections);
    }

    // Section by ID
    const sectionMatch = urlStr.match(/\/api\/sections\/(\w+)$/);
    if (sectionMatch && !options.method) {
      const id = sectionMatch[1];
      return mockResponse(responses[id] || { error: 'Not found' }, responses[id] ? 200 : 404);
    }

    // Create section
    if (urlStr.match(/\/api\/sections$/) && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      return mockResponse({ id: body.id || 'new-section' }, 201);
    }

    // Update section (rename)
    if (sectionMatch && options.method === 'PUT') {
      return mockResponse({ success: true });
    }

    // Delete section
    if (sectionMatch && options.method === 'DELETE') {
      return mockResponse({ success: true });
    }

    // Persons
    if (urlStr.includes('/api/persons') && !options.method) {
      return mockResponse({ persons: [{ id: 1, name: 'Jane Doe' }], activePersonId: 1 });
    }
    if (urlStr.includes('/api/persons') && options.method === 'POST' && !urlStr.includes('/switch')) {
      return mockResponse({ id: 2 }, 201);
    }
    if (urlStr.includes('/switch') && options.method === 'POST') {
      return mockResponse({ success: true });
    }

    // Style settings
    if (urlStr.includes('prefix=style')) {
      return mockResponse({});
    }

    // Create entry
    if (urlStr.includes('/entries') && options.method === 'POST') {
      return mockResponse({ id: 99 }, 201);
    }

    // Update entry/item
    if ((urlStr.includes('/api/entries/') || urlStr.includes('/api/items/')) && options.method === 'PUT') {
      return mockResponse({ success: true });
    }

    // Delete entry/item
    if ((urlStr.includes('/api/entries/') || urlStr.includes('/api/items/')) && options.method === 'DELETE') {
      return mockResponse({ success: true });
    }

    // Create item
    if (urlStr.includes('/items') && options.method === 'POST') {
      return mockResponse({ id: 999 }, 201);
    }

    // Documents
    if (urlStr.includes('/api/documents/') && !options.method) {
      return mockResponse(responses.documentSections);
    }
    if (urlStr.includes('/api/documents/') && options.method === 'PUT') {
      return mockResponse({ success: true });
    }

    // Coverletter sections
    if (urlStr.includes('/api/coverletter/sections') && !options.method) {
      return mockResponse(responses.coverletterSections);
    }
    if (urlStr.includes('/api/coverletter/sections') && options.method === 'POST') {
      return mockResponse({ id: 100 }, 201);
    }
    if (urlStr.includes('/api/coverletter/sections/') && options.method === 'PUT') {
      return mockResponse({ success: true });
    }
    if (urlStr.includes('/api/coverletter/sections/') && options.method === 'DELETE') {
      return mockResponse({ success: true });
    }

    // Compile
    if (urlStr.includes('/api/compile/') && options.method === 'POST') {
      return mockResponse({ success: true, pdfPath: '/api/pdf/cv' });
    }

    return mockResponse({ error: 'Unknown route: ' + urlStr }, 404);
  });

  global.fetch = fetchMock;
  return fetchMock;
}

function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(JSON.stringify(body)),
    text: async () => JSON.stringify(body),
  };
}

/**
 * Create an app instance by evaluating app.js and calling the factory.
 * Returns the Alpine-like data object with all methods.
 */
export function createAppInstance() {
  // Set up globals that app.js expects
  global.API_BASE = 'http://localhost:3001';
  global.Sortable = { create: () => ({ destroy: () => {} }) };
  global.ServiceConfig = { get: () => '' };
  global.CVStorage = {
    load: () => null,
    save: () => {},
    clear: () => {},
    exportJSON: () => {},
    importJSON: () => Promise.resolve({}),
  };

  const appCode = fs.readFileSync(APP_JS_PATH, 'utf-8');
  // eslint-disable-next-line no-new-func
  const fn = new Function(appCode + '\nreturn app();');
  const instance = fn();

  // Provide Alpine-like $watch and $nextTick stubs
  instance.$watch = vi.fn();
  instance.$nextTick = vi.fn((cb) => cb());

  return instance;
}

/**
 * Read the index.html content for DOM structure assertions.
 */
export function getIndexHtml() {
  return fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
}
