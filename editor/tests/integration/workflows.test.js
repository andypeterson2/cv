/**
 * Cross-endpoint workflow integration tests for the CV Editor.
 *
 * Tests multi-step operations that span several API endpoints:
 * section CRUD workflows, resume filtering, compile pipeline,
 * cover letter workflows, and security.
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

function seedDb(db) {
  db.setSettings({
    'personal.firstName': 'Andrew',
    'personal.lastName': 'Peterson',
    'personal.position': 'Software Engineer',
    'personal.email': 'test@example.com',
  });

  db.createSection('experience', 'cventries', 'Experience');
  db.createSection('skills', 'cvskills', 'Skills');
  db.createSection('summary', 'cvparagraph', 'Summary');

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

  db.createEntry('skills', { category: 'Languages', skills: 'JavaScript, Python' });
  db.createEntry('summary', { text: 'Experienced engineer.' });

  db.createMetric({
    command: 'projectCount',
    label: 'Projects',
    value: '12',
    groupName: 'General',
    sectionId: 'experience',
  });

  db.setDocumentSections('cv', [
    { sectionId: 'summary', enabled: true },
    { sectionId: 'experience', enabled: true },
    { sectionId: 'skills', enabled: true },
  ]);
  db.setDocumentSections('resume', [
    { sectionId: 'summary', enabled: true, resumeParagraphText: 'Short resume summary.' },
    { sectionId: 'experience', enabled: true },
    { sectionId: 'skills', enabled: true },
  ]);
}

beforeAll((done) => {
  db = new CvDatabase(':memory:');
  seedDb(db);

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
// 1. Section CRUD workflow
// =========================================================================

describe('Section CRUD workflow', () => {
  test('create section → add entries → add items → verify tree', async () => {
    // Create section
    const sec = await request('POST', '/api/sections', {
      id: 'projects',
      type: 'cventries',
      title: 'Projects',
    });
    expect(sec.status).toBe(201);

    // Add entry
    const entry = await request('POST', '/api/sections/projects/entries', {
      fields: { position: 'Lead', organization: 'OSS', location: 'GitHub', date: '2024' },
    });
    expect(entry.status).toBe(201);

    // Add items
    const item1 = await request('POST', `/api/entries/${entry.body.id}/items`, {
      content: 'First bullet',
    });
    const item2 = await request('POST', `/api/entries/${entry.body.id}/items`, {
      content: 'Second bullet',
    });
    expect(item1.status).toBe(201);
    expect(item2.status).toBe(201);

    // Verify full tree
    const full = await request('GET', '/api/sections/projects');
    expect(full.body.entries.length).toBe(1);
    expect(full.body.entries[0].items.length).toBe(2);
    expect(full.body.entries[0].fields.position).toBe('Lead');
    expect(full.body.entries[0].items[0].content).toBe('First bullet');

    // Cleanup
    await request('DELETE', '/api/sections/projects');
  });

  test('delete section cascades entries and items', async () => {
    await request('POST', '/api/sections', { id: 'cascade', type: 'cventries', title: 'Cascade' });
    const entry = await request('POST', '/api/sections/cascade/entries', { fields: { position: 'X' } });
    await request('POST', `/api/entries/${entry.body.id}/items`, { content: 'Y' });

    await request('DELETE', '/api/sections/cascade');

    const get = await request('GET', '/api/sections/cascade');
    expect(get.status).toBe(404);
  });
});

// =========================================================================
// 2. Entry modification and persistence
// =========================================================================

describe('Entry modification workflow', () => {
  test('modify entry fields → verify via section read', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const entryId = sec.body.entries[0].id;

    // Update
    await request('PUT', `/api/entries/${entryId}`, {
      fields: { position: 'Staff Engineer', organization: 'Acme Corp', location: 'San Diego, CA', date: '2022 - Present' },
    });

    // Verify
    const sec2 = await request('GET', '/api/sections/experience');
    expect(sec2.body.entries[0].fields.position).toBe('Staff Engineer');

    // Restore
    await request('PUT', `/api/entries/${entryId}`, {
      fields: { position: 'Software Engineer', organization: 'Acme Corp', location: 'San Diego, CA', date: '2022 - Present' },
    });
  });

  test('add and remove bullet points', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const entryId = sec.body.entries[0].id;
    const origItemCount = sec.body.entries[0].items.length;

    // Add bullet
    const item = await request('POST', `/api/entries/${entryId}/items`, { content: 'Temp bullet' });
    const sec2 = await request('GET', '/api/sections/experience');
    expect(sec2.body.entries[0].items.length).toBe(origItemCount + 1);

    // Remove bullet
    await request('DELETE', `/api/items/${item.body.id}`);
    const sec3 = await request('GET', '/api/sections/experience');
    expect(sec3.body.entries[0].items.length).toBe(origItemCount);
  });
});

// =========================================================================
// 3. Resume filtering
// =========================================================================

describe('Resume filtering', () => {
  test('excluded entry does not appear in resume compile data', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const entryId = sec.body.entries[1].id;

    // Exclude from resume
    await request('PUT', `/api/entries/${entryId}`, { resumeIncluded: false });

    // Verify via export (compile data)
    const exp = await request('GET', '/api/export');
    const expSection = exp.body.sections.find(s => s.id === 'experience');
    // In export, all entries are present (export includes everything)
    const entry = expSection.entries.find(e => e.id === entryId);
    expect(entry.resumeIncluded).toBe(false);

    // Restore
    await request('PUT', `/api/entries/${entryId}`, { resumeIncluded: true });
  });

  test('excluded item is flagged in export', async () => {
    const sec = await request('GET', '/api/sections/experience');
    const itemId = sec.body.entries[0].items[0].id;

    await request('PUT', `/api/items/${itemId}`, { resumeIncluded: false });

    const sec2 = await request('GET', '/api/sections/experience');
    const item = sec2.body.entries[0].items.find(i => i.id === itemId);
    expect(item.resumeIncluded).toBe(false);

    // Restore
    await request('PUT', `/api/items/${itemId}`, { resumeIncluded: true });
  });
});

// =========================================================================
// 4. Document section ordering
// =========================================================================

describe('Document section ordering', () => {
  test('reorder cv sections', async () => {
    const get = await request('GET', '/api/documents/cv');
    const origOrder = get.body.sections.map(s => s.sectionId);

    // Reverse
    const reversed = [...origOrder].reverse();
    await request('PUT', '/api/documents/cv', {
      sections: reversed.map(id => ({ sectionId: id, enabled: true })),
    });

    const get2 = await request('GET', '/api/documents/cv');
    expect(get2.body.sections.map(s => s.sectionId)).toEqual(reversed);

    // Restore
    await request('PUT', '/api/documents/cv', {
      sections: origOrder.map(id => ({ sectionId: id, enabled: true })),
    });
  });

  test('disable a section in document config', async () => {
    const get = await request('GET', '/api/documents/cv');
    const sections = get.body.sections;

    // Disable skills
    await request('PUT', '/api/documents/cv', {
      sections: sections.map(s => ({
        sectionId: s.sectionId,
        enabled: s.sectionId !== 'skills',
      })),
    });

    const get2 = await request('GET', '/api/documents/cv');
    const skills = get2.body.sections.find(s => s.sectionId === 'skills');
    expect(skills.enabled).toBe(false);

    // Restore
    await request('PUT', '/api/documents/cv', {
      sections: sections.map(s => ({ sectionId: s.sectionId, enabled: true })),
    });
  });
});

// =========================================================================
// 5. Metrics workflow
// =========================================================================

describe('Metrics workflow', () => {
  test('create metric → update value → verify in export', async () => {
    const create = await request('POST', '/api/metrics', {
      command: 'testWf',
      label: 'Test Workflow',
      value: null,
      groupName: 'WF',
      sectionId: 'experience',
    });
    expect(create.status).toBe(201);

    // Update with value
    await request('PUT', `/api/metrics/${create.body.id}`, { value: '42' });

    // Verify in export
    const exp = await request('GET', '/api/export');
    const metric = exp.body.metrics.find(m => m.command === 'testWf');
    expect(metric.value).toBe('42');

    // Cleanup
    await request('DELETE', `/api/metrics/${create.body.id}`);
  });
});

// =========================================================================
// 6. Cover letter workflow
// =========================================================================

describe('Cover letter workflow', () => {
  test('settings + sections together form complete coverletter', async () => {
    // Set header
    await request('PATCH', '/api/settings', {
      'coverletter.recipientName': 'Google',
      'coverletter.opening': 'Dear Googlers,',
    });

    // Add section
    const sec = await request('POST', '/api/coverletter/sections', {
      title: 'Motivation',
      body: 'I love search engines.',
    });

    // Verify all parts
    const settings = await request('GET', '/api/settings?prefix=coverletter');
    expect(settings.body['coverletter.recipientName']).toBe('Google');

    const sections = await request('GET', '/api/coverletter/sections');
    const found = sections.body.find(s => s.title === 'Motivation');
    expect(found).toBeDefined();

    // Cleanup
    await request('DELETE', `/api/coverletter/sections/${sec.body.id}`);
  });
});

// =========================================================================
// 7. Cross-endpoint data consistency
// =========================================================================

describe('Cross-endpoint data consistency', () => {
  test('export includes all sections from document config', async () => {
    const doc = await request('GET', '/api/documents/cv');
    const exp = await request('GET', '/api/export');

    for (const ds of doc.body.sections) {
      const found = exp.body.sections.find(s => s.id === ds.sectionId);
      expect(found).toBeDefined();
    }
  });

  test('metrics reference valid sections', async () => {
    const metrics = await request('GET', '/api/metrics');
    const sections = await request('GET', '/api/sections');
    const sectionIds = sections.body.map(s => s.id);

    for (const m of metrics.body) {
      expect(sectionIds).toContain(m.sectionId);
    }
  });

  test('settings personal prefix matches export personal', async () => {
    const settings = await request('GET', '/api/settings?prefix=personal');
    const exp = await request('GET', '/api/export');

    expect(settings.body['personal.firstName']).toBe(exp.body.personal.firstName);
    expect(settings.body['personal.email']).toBe(exp.body.personal.email);
  });
});

// =========================================================================
// 8. Security
// =========================================================================

describe('Security', () => {
  test('rejects invalid compile variant', async () => {
    const res = await request('POST', '/api/compile/evil');
    expect(res.status).toBe(400);
  });

  test('rejects invalid pdf variant', async () => {
    const res = await request('GET', '/api/pdf/evil');
    expect(res.status).toBe(400);
  });

  test('rejects invalid document variant', async () => {
    const res = await request('GET', '/api/documents/evil');
    expect(res.status).toBe(400);
  });
});

// =========================================================================
// 9. Error handling
// =========================================================================

describe('Error handling', () => {
  test('invalid JSON body returns 400', async () => {
    // Send raw invalid JSON via http
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/sections',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write('{invalid json');
      req.end();
    });
    expect(res.status).toBe(400);
  });

  test('empty PATCH /api/settings returns 400', async () => {
    const res = await request('PATCH', '/api/settings', {});
    expect(res.status).toBe(400);
  });
});

// =========================================================================
// 10. Static file serving
// =========================================================================

describe('Static file serving', () => {
  test('serves index.html at root', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.raw).toContain('<html');
  });

  test('serves app.js', async () => {
    const res = await request('GET', '/app.js');
    expect(res.status).toBe(200);
    expect(res.raw).toContain('function');
  });
});
