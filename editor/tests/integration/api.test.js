/**
 * Integration tests for the CV Editor server API.
 * Tests endpoints using an in-memory SQLite database.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const CvDatabase = require('../../lib/db');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

let server;
let port;

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

beforeAll(async () => {
  // Inject an in-memory DB so we don't touch any real files
  const app = require('../../server');
  const db = new CvDatabase(':memory:');
  app.setDb(db);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---- GET /api/seed ----

describe('GET /api/seed', () => {
  test('returns full state with all required keys', async () => {
    const res = await request('GET', '/api/seed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('resumeConfig');
    expect(res.body).toHaveProperty('document');
    expect(res.body).toHaveProperty('sectionData');
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
});

// ---- Sections API ----

describe('Sections API', () => {
  test('returns 409 for duplicate section', async () => {
    // 'experience' is seeded by default via Jane Doe data
    const sections = await request('GET', '/api/sections');
    if (sections.body.length > 0) {
      const existingId = sections.body[0].id;
      const res = await request('POST', '/api/sections', {
        id: existingId,
        type: 'experience',
        title: 'Dup',
      });
      expect(res.status).toBe(409);
    }
  });
});

// ---- Documents ----

describe('PUT /api/documents/:variant', () => {
  test('updates document sections', async () => {
    const get = await request('GET', '/api/documents/cv');
    const sections = get.body.sections;
    if (sections.length < 2) return; // Need at least 2 to reorder

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

// ---- Cover letter sections ----

describe('Cover letter sections', () => {
  test('GET returns seeded sections', async () => {
    const res = await request('GET', '/api/coverletter/sections');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
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
    await request('PUT', `/api/coverletter/sections/${id}`, { title: all.body[0].title });
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
    if (all.body.length < 2) return; // Need at least 2 to reorder
    const ids = all.body.map(s => s.id);
    const reversed = [...ids].reverse();

    await request('PATCH', '/api/coverletter/sections/order', { ids: reversed });

    const all2 = await request('GET', '/api/coverletter/sections');
    expect(all2.body.map(s => s.id)).toEqual(reversed);

    // Restore
    await request('PATCH', '/api/coverletter/sections/order', { ids });
  });
});

// ---- Export + Health ----

describe('GET /api/export', () => {
  test('returns full export', async () => {
    const res = await request('GET', '/api/export');
    expect(res.status).toBe(200);
    expect(res.body.personal).toBeDefined();
    expect(res.body.sections).toBeDefined();
  });
});

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ---- Validation ----

describe('Request validation', () => {
  test('rejects createSection with missing fields', async () => {
    const res = await request('POST', '/api/sections', { id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('rejects createEntry with missing fields', async () => {
    const sections = await request('GET', '/api/sections');
    if (sections.body.length > 0) {
      const id = sections.body[0].id;
      const res = await request('POST', `/api/sections/${id}/entries`, {});
      expect(res.status).toBe(400);
    }
  });

  test('rejects reorder with duplicate ids', async () => {
    const sections = await request('GET', '/api/sections');
    if (sections.body.length > 0) {
      const id = sections.body[0].id;
      const res = await request('PATCH', `/api/sections/${id}/entries/order`, {
        ids: [1, 1, 2],
      });
      expect(res.status).toBe(400);
    }
  });
});

// ---- Static files ----

describe('Static file serving', () => {
  test('serves index.html at root', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.raw).toContain('<html');
  });
});

// ---- Persons API ----

describe('Persons API', () => {
  test('GET /api/persons returns persons with activePersonId', async () => {
    const res = await request('GET', '/api/persons');
    expect(res.status).toBe(200);
    expect(res.body.persons).toBeInstanceOf(Array);
    expect(res.body.persons.length).toBeGreaterThan(0);
    expect(res.body.activePersonId).toBeTruthy();
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
    const create = await request('POST', '/api/persons', { name: 'Switch Target' });
    const newId = create.body.id;

    const res = await request('POST', '/api/persons/' + newId + '/switch');
    expect(res.status).toBe(200);

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

// ---- Per-person JSON export ----

describe('GET /api/persons/:id/export', () => {
  test('returns the stored JSON for a non-active person', async () => {
    // Seed the active person with some data first so save-on-switch captures it
    await request('POST', '/api/import', {
      personal: { firstName: 'Active', lastName: 'User' },
      sections: [], documents: { cv: [], resume: [] }, coverletter: { sections: [] },
    });
    // Create a new person and seed their stored data via switch + import + save
    const create = await request('POST', '/api/persons', { name: 'Export Target' });
    const id = create.body.id;
    await request('POST', '/api/persons/' + id + '/switch');
    await request('POST', '/api/import', {
      personal: { firstName: 'Stored', lastName: 'Snapshot' },
      sections: [{ id: 's', type: 'cventries', title: 'S', entries: [] }],
      documents: { cv: [{ sectionId: 's', enabled: true, sortOrder: 0 }], resume: [] },
      coverletter: { sections: [] },
    });
    await request('POST', '/api/persons/' + id + '/save');
    // Switch away so the request hits the non-active branch
    const list = await request('GET', '/api/persons');
    const otherId = list.body.persons.find(p => p.id !== id).id;
    await request('POST', '/api/persons/' + otherId + '/switch');

    const res = await request('GET', '/api/persons/' + id + '/export');
    expect(res.status).toBe(200);
    expect(res.body.personal.firstName).toBe('Stored');
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0].id).toBe('s');
  });

  test('returns fresh working-state data for the active person (reads live tables)', async () => {
    // Import data — leaves working tables populated but persons.data may be stale.
    // The active-person export reads live working state, so it reflects this.
    await request('POST', '/api/import', {
      personal: { firstName: 'Fresh', lastName: 'Active' },
      sections: [], documents: { cv: [], resume: [] }, coverletter: { sections: [] },
    });
    const list = await request('GET', '/api/persons');
    const id = list.body.activePersonId;

    const res = await request('GET', '/api/persons/' + id + '/export');
    expect(res.status).toBe(200);
    expect(res.body.personal.firstName).toBe('Fresh');
  });

  test('returns 404 for non-existent person', async () => {
    const res = await request('GET', '/api/persons/99999/export');
    expect(res.status).toBe(404);
  });

  test('returns 400 for non-numeric person id', async () => {
    const res = await request('GET', '/api/persons/abc/export');
    expect(res.status).toBe(400);
  });
});

// ---- Per-person variant PDF ----
//
// These tests cover validation/error paths only — successful renders require
// xelatex + font caches which aren't guaranteed outside the Docker image. The
// happy path is exercised by /api/compile and the corresponding manual smoke
// tests; the route shares the same generate+xelatex code path here.

describe('GET /api/persons/:id/pdf/:variant', () => {
  test('returns 400 for invalid variant', async () => {
    const res = await request('GET', '/api/persons/1/pdf/not-a-variant');
    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent person', async () => {
    const res = await request('GET', '/api/persons/99999/pdf/cv');
    expect(res.status).toBe(404);
  });

  test('returns 400 when the person row exists but has no data', async () => {
    const create = await request('POST', '/api/persons', { name: 'Empty Person For PDF' });
    const id = create.body.id;
    const res = await request('GET', '/api/persons/' + id + '/pdf/cv');
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-numeric person id', async () => {
    const res = await request('GET', '/api/persons/abc/pdf/cv');
    expect(res.status).toBe(400);
  });
});

// ---- Import API ----

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

// ---- Person Switch Workflow ----

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
