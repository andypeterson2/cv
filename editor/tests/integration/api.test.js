/**
 * Integration tests for the CV Editor REST API.
 * Tests HTTP endpoints against a running server with an in-memory SQLite DB.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

// HTTP helper
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// Seed the in-memory DB with test data
function seedDb(db) {
  db.setSettings({
    'personal.firstName': 'Andrew',
    'personal.lastName': 'Peterson',
    'personal.position': 'Software Engineer',
    'personal.email': 'test@example.com',
    'coverletter.recipientName': 'Hiring Team',
    'coverletter.recipientAddress': '123 Main St',
    'coverletter.title': 'Application',
    'coverletter.opening': 'Dear Team,',
    'coverletter.closing': 'Sincerely,',
    'coverletter.enclosureLabel': 'Attached',
    'coverletter.enclosureContent': 'Resume',
  });

  db.createSection('experience', 'cventries', 'Experience');
  db.createSection('skills', 'cvskills', 'Skills');
  db.createSection('summary', 'cvparagraph', 'Summary');
  db.createSection('certifications', 'cvhonors', 'Certifications');

  const e1 = db.createEntry('experience', {
    position: 'Software Engineer',
    organization: 'Acme Corp',
    location: 'San Diego, CA',
    date: '2022 - Present',
  });
  db.createItem(Number(e1), 'Built distributed systems');
  db.createItem(Number(e1), 'Led team of 5');

  const e2 = db.createEntry('experience', {
    position: 'Intern',
    organization: 'Startup Inc',
    location: 'Remote',
    date: '2021',
  });
  db.createItem(Number(e2), 'Developed APIs');

  db.createEntry('skills', { category: 'Languages', skills: 'JavaScript, Python, Go' });
  db.createEntry('skills', { category: 'Tools', skills: 'Docker, Git, Linux' });

  db.createEntry('summary', { text: 'Experienced software engineer with a passion for quantum computing.' });

  db.createEntry('certifications', {
    award: 'AWS Certified',
    issuer: 'Amazon',
    location: '',
    date: '2023',
  });

  db.createMetric({
    command: 'projectCount',
    label: 'Projects',
    value: '12',
    groupName: 'General',
    sectionId: 'experience',
  });
  db.createMetric({
    command: 'qubitCount',
    label: 'Qubits',
    value: null,
    groupName: 'QI',
    sectionId: 'experience',
  });

  db.setDocumentSections('cv', [
    { sectionId: 'summary', enabled: true },
    { sectionId: 'experience', enabled: true },
    { sectionId: 'skills', enabled: true },
    { sectionId: 'certifications', enabled: true },
  ]);
  db.setDocumentSections('resume', [
    { sectionId: 'summary', enabled: true, resumeParagraphText: 'Short resume summary.' },
    { sectionId: 'experience', enabled: true },
    { sectionId: 'skills', enabled: true },
  ]);

  db.createCoverletterSection('About Me', 'I am a software engineer.');
  db.createCoverletterSection('Why Me?', 'I bring deep expertise.');
}

beforeAll((done) => {
  // Use fresh in-memory DB for each test run
  db = new CvDatabase(':memory:');
  seedDb(db);

  // Clear require cache so we get a fresh app
  delete require.cache[require.resolve('../../server')];
  const app = require('../../server');
  app.setDb(db);

  server = app.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  if (db) db.close();
  if (server) server.close(done);
  else done();
});

// =========================================================================
// Settings
// =========================================================================

describe('GET /api/settings', () => {
  test('returns all settings', async () => {
    const res = await request('GET', '/api/settings');
    expect(res.status).toBe(200);
    expect(res.body['personal.firstName']).toBe('Andrew');
    expect(res.body['coverletter.title']).toBe('Application');
  });

  test('returns filtered settings by prefix', async () => {
    const res = await request('GET', '/api/settings?prefix=personal');
    expect(res.status).toBe(200);
    expect(res.body['personal.firstName']).toBe('Andrew');
    expect(res.body['coverletter.title']).toBeUndefined();
  });

  test('returns empty for unknown prefix', async () => {
    const res = await request('GET', '/api/settings?prefix=unknown');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).length).toBe(0);
  });
});

describe('PATCH /api/settings', () => {
  test('upserts settings', async () => {
    const res = await request('PATCH', '/api/settings', {
      'personal.firstName': 'Andy',
    });
    expect(res.status).toBe(200);

    const get = await request('GET', '/api/settings?prefix=personal');
    expect(get.body['personal.firstName']).toBe('Andy');

    // Restore
    await request('PATCH', '/api/settings', { 'personal.firstName': 'Andrew' });
  });

  test('rejects empty body', async () => {
    const res = await request('PATCH', '/api/settings', {});
    expect(res.status).toBe(400);
  });
});

// =========================================================================
// Sections
// =========================================================================

describe('GET /api/sections', () => {
  test('returns all sections', async () => {
    const res = await request('GET', '/api/sections');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(4);
    expect(res.body.map(s => s.id)).toContain('experience');
  });
});

describe('GET /api/sections/:id', () => {
  test('returns section with entries and items', async () => {
    const res = await request('GET', '/api/sections/experience');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('cventries');
    expect(res.body.title).toBe('Experience');
    expect(res.body.entries.length).toBe(2);
    expect(res.body.entries[0].items.length).toBe(2);
  });

  test('returns 404 for missing section', async () => {
    const res = await request('GET', '/api/sections/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sections', () => {
  test('creates a new section', async () => {
    const res = await request('POST', '/api/sections', {
      id: 'projects',
      type: 'cventries',
      title: 'Projects',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('projects');

    // Verify
    const get = await request('GET', '/api/sections/projects');
    expect(get.body.title).toBe('Projects');

    // Cleanup
    await request('DELETE', '/api/sections/projects');
  });

  test('returns 409 for duplicate section', async () => {
    const res = await request('POST', '/api/sections', {
      id: 'experience',
      type: 'cventries',
      title: 'Dup',
    });
    expect(res.status).toBe(409);
  });

  test('rejects invalid type', async () => {
    const res = await request('POST', '/api/sections', {
      id: 'bad',
      type: 'invalid',
      title: 'Bad',
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sections/:id', () => {
  test('updates section title', async () => {
    const res = await request('PUT', '/api/sections/skills', { title: 'Technical Skills' });
    expect(res.status).toBe(200);

    const get = await request('GET', '/api/sections/skills');
    expect(get.body.title).toBe('Technical Skills');

    // Restore
    await request('PUT', '/api/sections/skills', { title: 'Skills' });
  });
});

describe('DELETE /api/sections/:id', () => {
  test('deletes section and cascades', async () => {
    // Create temp section with entries
    await request('POST', '/api/sections', { id: 'temp', type: 'cventries', title: 'Temp' });
    await request('POST', '/api/sections/temp/entries', { fields: { position: 'X' } });

    const del = await request('DELETE', '/api/sections/temp');
    expect(del.status).toBe(200);

    const get = await request('GET', '/api/sections/temp');
    expect(get.status).toBe(404);
  });
});

// =========================================================================
// Entries
// =========================================================================

describe('POST /api/sections/:id/entries', () => {
  test('creates entry', async () => {
    const res = await request('POST', '/api/sections/experience/entries', {
      fields: { position: 'CTO', organization: 'Test', location: 'NYC', date: '2025' },
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('number');

    // Cleanup
    await request('DELETE', `/api/entries/${res.body.id}`);
  });

  test('returns 404 for missing section', async () => {
    const res = await request('POST', '/api/sections/missing/entries', { fields: {} });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/entries/:id', () => {
  test('updates entry fields', async () => {
    // Get experience entries
    const sec = await request('GET', '/api/sections/experience');
    const entryId = sec.body.entries[0].id;

    const res = await request('PUT', `/api/entries/${entryId}`, {
      fields: { position: 'Senior Engineer', organization: 'Acme Corp', location: 'San Diego, CA', date: '2022 - Present' },
    });
    expect(res.status).toBe(200);

    // Verify
    const sec2 = await request('GET', '/api/sections/experience');
    expect(sec2.body.entries[0].fields.position).toBe('Senior Engineer');

    // Restore
    await request('PUT', `/api/entries/${entryId}`, {
      fields: { position: 'Software Engineer', organization: 'Acme Corp', location: 'San Diego, CA', date: '2022 - Present' },
    });
  });

  test('toggles resumeIncluded', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const entryId = sec.body.entries[1].id;

    await request('PUT', `/api/entries/${entryId}`, { resumeIncluded: false });
    const sec2 = await request('GET', '/api/sections/experience');
    const entry = sec2.body.entries.find(e => e.id === entryId);
    expect(entry.resumeIncluded).toBe(false);

    // Restore
    await request('PUT', `/api/entries/${entryId}`, { resumeIncluded: true });
  });
});

describe('DELETE /api/entries/:id', () => {
  test('deletes entry', async () => {
    const res = await request('POST', '/api/sections/experience/entries', {
      fields: { position: 'Temp' },
    });
    const del = await request('DELETE', `/api/entries/${res.body.id}`);
    expect(del.status).toBe(200);
  });
});

describe('PATCH /api/sections/:id/entries/order', () => {
  test('reorders entries', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const ids = sec.body.entries.map(e => e.id);

    // Reverse order
    const reversed = [...ids].reverse();
    const res = await request('PATCH', '/api/sections/experience/entries/order', { ids: reversed });
    expect(res.status).toBe(200);

    // Verify new order
    const sec2 = await request('GET', '/api/sections/experience');
    expect(sec2.body.entries.map(e => e.id)).toEqual(reversed);

    // Restore
    await request('PATCH', '/api/sections/experience/entries/order', { ids });
  });
});

// =========================================================================
// Items
// =========================================================================

describe('Items CRUD', () => {
  let testEntryId;

  beforeAll(async () => {
    const sec = await request('GET', '/api/sections/experience');
    testEntryId = sec.body.entries[0].id;
  });

  test('creates item', async () => {
    const res = await request('POST', `/api/entries/${testEntryId}/items`, {
      content: 'New bullet point',
    });
    expect(res.status).toBe(201);

    // Cleanup
    await request('DELETE', `/api/items/${res.body.id}`);
  });

  test('updates item', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const itemId = sec.body.entries[0].items[0].id;

    await request('PUT', `/api/items/${itemId}`, { content: 'Updated bullet' });
    const sec2 = await request('GET', '/api/sections/experience');
    const item = sec2.body.entries[0].items.find(i => i.id === itemId);
    expect(item.content).toBe('Updated bullet');

    // Restore
    await request('PUT', `/api/items/${itemId}`, { content: 'Built distributed systems' });
  });

  test('toggles item resumeIncluded', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const itemId = sec.body.entries[0].items[0].id;

    await request('PUT', `/api/items/${itemId}`, { resumeIncluded: false });
    const sec2 = await request('GET', '/api/sections/experience');
    const item = sec2.body.entries[0].items.find(i => i.id === itemId);
    expect(item.resumeIncluded).toBe(false);

    // Restore
    await request('PUT', `/api/items/${itemId}`, { resumeIncluded: true });
  });

  test('deletes item', async () => {
    const res = await request('POST', `/api/entries/${testEntryId}/items`, { content: 'Delete me' });
    const del = await request('DELETE', `/api/items/${res.body.id}`);
    expect(del.status).toBe(200);
  });
});

// =========================================================================
// Metrics
// =========================================================================

describe('GET /api/metrics', () => {
  test('returns all metrics', async () => {
    const res = await request('GET', '/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].command).toBe('projectCount');
  });

  test('filters by section', async () => {
    const res = await request('GET', '/api/metrics?section=experience');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});

describe('POST /api/metrics', () => {
  test('creates metric', async () => {
    const res = await request('POST', '/api/metrics', {
      command: 'testMetric',
      label: 'Test',
      value: '42',
      groupName: 'Test',
      sectionId: 'experience',
    });
    expect(res.status).toBe(201);

    // Cleanup
    await request('DELETE', `/api/metrics/${res.body.id}`);
  });

  test('returns 409 for duplicate command', async () => {
    const res = await request('POST', '/api/metrics', {
      command: 'projectCount',
      sectionId: 'experience',
    });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/metrics/:id', () => {
  test('updates metric value', async () => {
    const all = await request('GET', '/api/metrics');
    const metric = all.body.find(m => m.command === 'projectCount');

    await request('PUT', `/api/metrics/${metric.id}`, { value: '99' });

    const all2 = await request('GET', '/api/metrics');
    const updated = all2.body.find(m => m.id === metric.id);
    expect(updated.value).toBe('99');

    // Restore
    await request('PUT', `/api/metrics/${metric.id}`, { value: '12' });
  });
});

describe('DELETE /api/metrics/:id', () => {
  test('deletes metric', async () => {
    const res = await request('POST', '/api/metrics', {
      command: 'deleteme',
      sectionId: 'experience',
    });
    const del = await request('DELETE', `/api/metrics/${res.body.id}`);
    expect(del.status).toBe(200);
  });
});

// =========================================================================
// Document sections
// =========================================================================

describe('GET /api/documents/:variant', () => {
  test('returns cv document sections', async () => {
    const res = await request('GET', '/api/documents/cv');
    expect(res.status).toBe(200);
    expect(res.body.variant).toBe('cv');
    expect(res.body.sections.length).toBe(4);
  });

  test('returns resume document sections', async () => {
    const res = await request('GET', '/api/documents/resume');
    expect(res.status).toBe(200);
    expect(res.body.sections.length).toBe(3);
  });

  test('rejects invalid variant', async () => {
    const res = await request('GET', '/api/documents/invalid');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/documents/:variant', () => {
  test('updates document sections', async () => {
    const get = await request('GET', '/api/documents/cv');
    const sections = get.body.sections;

    // Reorder
    const reordered = [...sections].reverse();
    await request('PUT', '/api/documents/cv', {
      sections: reordered.map(s => ({ sectionId: s.sectionId, enabled: s.enabled })),
    });

    const get2 = await request('GET', '/api/documents/cv');
    expect(get2.body.sections[0].sectionId).toBe(reordered[0].sectionId);

    // Restore
    await request('PUT', '/api/documents/cv', {
      sections: sections.map(s => ({ sectionId: s.sectionId, enabled: s.enabled })),
    });
  });
});

// =========================================================================
// Cover letter sections
// =========================================================================

describe('Cover letter sections', () => {
  test('GET returns seeded sections', async () => {
    const res = await request('GET', '/api/coverletter/sections');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].title).toBe('About Me');
  });

  test('POST creates section', async () => {
    const res = await request('POST', '/api/coverletter/sections', {
      title: 'New Section',
      body: 'New body text.',
    });
    expect(res.status).toBe(201);

    // Cleanup
    await request('DELETE', `/api/coverletter/sections/${res.body.id}`);
  });

  test('PUT updates section', async () => {
    const all = await request('GET', '/api/coverletter/sections');
    const id = all.body[0].id;

    await request('PUT', `/api/coverletter/sections/${id}`, { title: 'Updated Title' });

    const all2 = await request('GET', '/api/coverletter/sections');
    expect(all2.body.find(s => s.id === id).title).toBe('Updated Title');

    // Restore
    await request('PUT', `/api/coverletter/sections/${id}`, { title: 'About Me' });
  });

  test('DELETE removes section', async () => {
    const res = await request('POST', '/api/coverletter/sections', {
      title: 'Delete Me',
      body: 'x',
    });
    const del = await request('DELETE', `/api/coverletter/sections/${res.body.id}`);
    expect(del.status).toBe(200);
  });

  test('PATCH reorders sections', async () => {
    const all = await request('GET', '/api/coverletter/sections');
    const ids = all.body.map(s => s.id);
    const reversed = [...ids].reverse();

    await request('PATCH', '/api/coverletter/sections/order', { ids: reversed });

    const all2 = await request('GET', '/api/coverletter/sections');
    expect(all2.body.map(s => s.id)).toEqual(reversed);

    // Restore
    await request('PATCH', '/api/coverletter/sections/order', { ids });
  });
});

// =========================================================================
// Export + Health
// =========================================================================

describe('GET /api/export', () => {
  test('returns full export', async () => {
    const res = await request('GET', '/api/export');
    expect(res.status).toBe(200);
    expect(res.body.personal.firstName).toBe('Andrew');
    expect(res.body.sections.length).toBe(4);
    expect(res.body.metrics.length).toBe(2);
    expect(res.body.coverletter.sections.length).toBe(2);
  });
});

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// =========================================================================
// Validation
// =========================================================================

describe('Request validation', () => {
  test('rejects createSection with missing fields', async () => {
    const res = await request('POST', '/api/sections', { id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('rejects createEntry with missing fields', async () => {
    const res = await request('POST', '/api/sections/experience/entries', {});
    expect(res.status).toBe(400);
  });

  test('rejects reorder with duplicate ids', async () => {
    const res = await request('PATCH', '/api/sections/experience/entries/order', {
      ids: [1, 1, 2],
    });
    expect(res.status).toBe(400);
  });

  test('rejects metric with numeric command', async () => {
    const res = await request('POST', '/api/metrics', {
      command: 'abc123',
      sectionId: 'experience',
    });
    expect(res.status).toBe(400);
  });
});

// =========================================================================
// Static files
// =========================================================================

describe('Static file serving', () => {
  test('serves index.html at root', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.raw).toContain('<html');
  });
});
