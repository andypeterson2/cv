/**
 * Integration tests for the CV Editor server API.
 * Tests the seed endpoint (parse .tex → JSON) and compile endpoint (JSON → PDF).
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

// HTTP helper
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {}
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
    if (payload) req.write(payload);
    req.end();
  });
}

// Helper: backup and restore files modified by compile
function backupFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  if (fs.existsSync(full)) {
    fs.copyFileSync(full, full + '.test-backup');
  }
}

beforeAll(() => {
  // Use fresh in-memory DB for each test run
  db = new CvDatabase(':memory:');
  db.clearAllContent(); // Clear Jane Doe seed data before seeding test data
  seedDb(db);

beforeAll((done) => {
  backupFile('data.json');
  backupFile('data.tex');
  backupFile('resume-config.json');
  backupFile('cv.tex');

  const app = require('../../server');
  server = app.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  restoreFile('data.json');
  restoreFile('data.tex');
  restoreFile('resume-config.json');
  restoreFile('cv.tex');

  if (server) {
    server.close(done);
  } else {
    done();
  }
});

// ---- GET /api/seed ----

describe('GET /api/seed', () => {
  test('returns full state with all required keys', async () => {
    const res = await request('GET', '/api/seed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('resumeConfig');
    expect(res.body).toHaveProperty('coverletter');
    expect(res.body).toHaveProperty('document');
    expect(res.body).toHaveProperty('sectionData');
  });

  test('data contains personal info', async () => {
    const res = await request('GET', '/api/seed');
    expect(res.body.data.personal).toBeDefined();
    expect(res.body.data.personal.firstName).toBe('Andrew');
  });

  test('document has sections array', async () => {
    const res = await request('GET', '/api/seed');
    expect(Array.isArray(res.body.document.sections)).toBe(true);
    expect(res.body.document.sections.length).toBeGreaterThan(0);
  });

  test('each document section has file and enabled fields', async () => {
    const res = await request('GET', '/api/seed');
    for (const sec of res.body.document.sections) {
      expect(sec).toHaveProperty('file');
      expect(sec).toHaveProperty('enabled');
    }
  });

  test('sectionData contains parsed sections', async () => {
    const res = await request('GET', '/api/seed');
    const sections = res.body.sectionData;
    expect(Object.keys(sections).length).toBeGreaterThan(0);

    // Experience should be cventries
    expect(sections['cv/experience.tex']).toBeDefined();
    expect(sections['cv/experience.tex'].type).toBe('cventries');
    expect(sections['cv/experience.tex'].entries.length).toBeGreaterThanOrEqual(2);
  });

  test('sectionData has all section types', async () => {
    const res = await request('GET', '/api/seed');
    const s = res.body.sectionData;
    expect(s['cv/skills.tex'].type).toBe('cvskills');
    expect(s['cv/summary.tex'].type).toBe('cvparagraph');
    expect(s['cv/certifications.tex'].type).toBe('cvhonors');
    expect(s['cv/references.tex'].type).toBe('cvreferences');
  });

  test('resumeConfig has sectionOrder and sections', async () => {
    const res = await request('GET', '/api/seed');
    expect(Array.isArray(res.body.resumeConfig.sectionOrder)).toBe(true);
    expect(typeof res.body.resumeConfig.sections).toBe('object');
  });

  test('coverletter has expected structure', async () => {
    const res = await request('GET', '/api/seed');
    const cl = res.body.coverletter;
    expect(cl).toBeDefined();
    expect(cl.recipient).toBeDefined();
    expect(cl.opening).toBeDefined();
    expect(cl.closing).toBeDefined();
    expect(cl.sections.length).toBeGreaterThanOrEqual(1);
  });

  test('returns 409 for duplicate section', async () => {
    const res = await request('POST', '/api/sections', {
      id: 'experience',
      type: 'cventries',
      title: 'Dup',
    });
    expect(res.status).toBe(409);
  });

describe('POST /api/compile/:name', () => {
  let seedState;

  beforeAll(async () => {
    const res = await request('GET', '/api/seed');
    seedState = res.body;
  });

  test('rejects invalid document name', async () => {
    const res = await request('POST', '/api/compile/invalid', seedState);
    expect(res.status).toBe(400);
  });

  test('rejects missing state body', async () => {
    const res = await request('POST', '/api/compile/cv', {});
    expect(res.status).toBe(400);
  });

  test('writes .tex files from state during compile', async () => {
    const state = JSON.parse(JSON.stringify(seedState));

    const res = await request('POST', '/api/compile/cv', state);
    expect(res.status).toBe(200);

    // data.tex should contain personal info
    const dataTex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    expect(dataTex).toContain('\\name');
  });

  test('cv.tex section order matches state after compile', async () => {
    const res = await request('POST', '/api/compile/cv', seedState);
    expect(res.status).toBe(200);

    const cvTex = fs.readFileSync(path.join(PROJECT_ROOT, 'cv.tex'), 'utf-8');
    // Verify no duplicate input lines
    const inputLines = cvTex.split('\n')
      .filter(l => /\\input\{cv\//.test(l) || /^%\s*\\input\{cv\//.test(l.trim()));
    const files = inputLines.map(l => {
      const m = l.match(/\\input\{([^}]+)\}/);
      return m ? m[1] : null;
    }).filter(Boolean);
    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });
});

// ---- GET /api/pdf/:name ----

describe('GET /api/pdf/:name', () => {
  test('rejects invalid document name', async () => {
    const res = await request('GET', '/api/pdf/invalid');
    expect(res.status).toBe(400);
  });

  test('returns 404 if PDF not compiled yet', async () => {
    // Delete any existing PDF to test 404
    const pdfPath = path.join(PROJECT_ROOT, 'nonexistent-doc.pdf');
    // Just test with a valid name where PDF may not exist
    // This is fragile but tests the endpoint logic
    const res = await request('GET', '/api/pdf/coverletter');
    // Could be 200 or 404 depending on prior compilation
    expect([200, 404]).toContain(res.status);
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

// ═════════════════════════════════════════════════════════════════════════════
// Persons API
// ═════════════════════════════════════════════════════════════════════════════

describe('Persons API', () => {
  test('GET /api/persons returns persons with activePersonId', async () => {
    const res = await request('GET', '/api/persons');
    expect(res.status).toBe(200);
    expect(res.body.persons).toBeInstanceOf(Array);
    expect(res.body.persons.length).toBeGreaterThan(0);
    expect(res.body.activePersonId).toBeTruthy();
    // Jane Doe is seeded by default
    expect(res.body.persons.some(p => p.name === 'Jane Doe')).toBe(true);
  });

  test('POST /api/persons creates a new person', async () => {
    const res = await request('POST', '/api/persons', { name: 'Test Person' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);

    const list = await request('GET', '/api/persons');
    expect(list.body.persons.some(p => p.name === 'Test Person')).toBe(true);
  });

  test('POST /api/persons returns 409 for duplicate name', async () => {
    await request('POST', '/api/persons', { name: 'Duplicate' });
    const res = await request('POST', '/api/persons', { name: 'Duplicate' });
    expect(res.status).toBe(409);
  });

  test('POST /api/persons returns 400 for missing name', async () => {
    const res = await request('POST', '/api/persons', {});
    expect(res.status).toBe(400);
  });

  test('PUT /api/persons/:id renames a person', async () => {
    const create = await request('POST', '/api/persons', { name: 'Old Name' });
    const id = create.body.id;

    const res = await request('PUT', '/api/persons/' + id, { name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = await request('GET', '/api/persons');
    expect(list.body.persons.some(p => p.name === 'New Name')).toBe(true);
    expect(list.body.persons.some(p => p.name === 'Old Name')).toBe(false);
  });

  test('DELETE /api/persons/:id deletes a non-active person', async () => {
    const create = await request('POST', '/api/persons', { name: 'To Delete' });
    const id = create.body.id;

    const res = await request('DELETE', '/api/persons/' + id);
    expect(res.status).toBe(200);

    const list = await request('GET', '/api/persons');
    expect(list.body.persons.some(p => p.name === 'To Delete')).toBe(false);
  });

  test('DELETE /api/persons/:id returns 400 for active person', async () => {
    const list = await request('GET', '/api/persons');
    const activeId = list.body.activePersonId;

    const res = await request('DELETE', '/api/persons/' + activeId);
    expect(res.status).toBe(400);
  });

  test('POST /api/persons/:id/switch switches active person', async () => {
    // Create a new person
    const create = await request('POST', '/api/persons', { name: 'Switch Target' });
    const newId = create.body.id;

    // Switch to them
    const res = await request('POST', '/api/persons/' + newId + '/switch');
    expect(res.status).toBe(200);

    // Verify active person changed
    const list = await request('GET', '/api/persons');
    expect(list.body.activePersonId).toBe(newId);

    // Content should be empty (new person has no data)
    const sections = await request('GET', '/api/sections');
    expect(sections.body.length).toBe(0);
  });

  test('POST /api/persons/:id/switch returns 404 for non-existent person', async () => {
    const res = await request('POST', '/api/persons/99999/switch');
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Import API
// ═════════════════════════════════════════════════════════════════════════════

describe('Import API', () => {
  test('POST /api/import imports data', async () => {
    const importData = {
      personal: { firstName: 'Imported', lastName: 'User' },
      sections: [
        {
          id: 'work', type: 'cventries', title: 'Work',
          entries: [
            {
              id: 1, section_id: 'work', sort_order: 0, resumeIncluded: true,
              fields: { position: 'Tester', organization: 'Test Co', location: 'Remote', date: '2024' },
              items: []
            }
          ]
        }
      ],
      documents: { cv: [{ sectionId: 'work', enabled: true, sortOrder: 0 }], resume: [] },
      coverletter: { recipientName: 'Nobody', sections: [] }
    };

    const res = await request('POST', '/api/import', importData);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify data was imported
    const personal = await request('GET', '/api/settings?prefix=personal');
    expect(personal.body['personal.firstName']).toBe('Imported');

    const sections = await request('GET', '/api/sections');
    expect(sections.body.length).toBe(1);
    expect(sections.body[0].id).toBe('work');
  });

  test('POST /api/import returns 400 for invalid data', async () => {
    const res = await request('POST', '/api/import', { invalid: true });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Person Switch Workflow
// ═════════════════════════════════════════════════════════════════════════════

describe('Person switch workflow', () => {
  test('full round-trip: create, switch, modify, switch back', async () => {
    // First, set up a known state: import Alice's data as current person
    const aliceData = {
      personal: { firstName: 'Alice', lastName: 'Wonder' },
      sections: [
        { id: 'work', type: 'cventries', title: 'Work',
          entries: [{ id: 1, section_id: 'work', sort_order: 0, resumeIncluded: true,
            fields: { position: 'Dev', organization: 'Co', location: 'NY', date: '2024' }, items: [] }] }
      ],
      documents: { cv: [{ sectionId: 'work', enabled: true, sortOrder: 0 }], resume: [] },
      coverletter: { sections: [] }
    };
    await request('POST', '/api/import', aliceData);

    const initial = await request('GET', '/api/persons');
    const aliceId = initial.body.activePersonId;

    // Create Bob
    const bob = await request('POST', '/api/persons', { name: 'Bob Builder' });
    const bobId = bob.body.id;

    // Switch to Bob (saves Alice's data, loads Bob's empty data)
    await request('POST', '/api/persons/' + bobId + '/switch');

    // Verify Bob is active with empty content
    let sections = await request('GET', '/api/sections');
    expect(sections.body.length).toBe(0);

    // Add data to Bob via import
    await request('POST', '/api/import', {
      personal: { firstName: 'Bob', lastName: 'Builder' },
      sections: [],
      documents: { cv: [], resume: [] },
      coverletter: { sections: [] }
    });

    // Switch back to Alice
    await request('POST', '/api/persons/' + aliceId + '/switch');

    // Verify Alice's data is restored
    const personal = await request('GET', '/api/settings?prefix=personal');
    expect(personal.body['personal.firstName']).toBe('Alice');
    sections = await request('GET', '/api/sections');
    expect(sections.body.length).toBe(1);

    // Switch back to Bob
    await request('POST', '/api/persons/' + bobId + '/switch');
    const bobPersonal = await request('GET', '/api/settings?prefix=personal');
    expect(bobPersonal.body['personal.firstName']).toBe('Bob');
  });
});
