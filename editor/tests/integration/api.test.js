/**
 * Integration tests for the CV Editor server API.
 * Tests actual HTTP endpoints against the running server.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
let server;
let port;

// Helper: make HTTP request and return parsed JSON
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Helper: backup and restore files
function backupFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  if (fs.existsSync(full)) {
    fs.copyFileSync(full, full + '.test-backup');
  }
}

function restoreFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  const backup = full + '.test-backup';
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, full);
    fs.unlinkSync(backup);
  }
}

beforeAll((done) => {
  // Backup files that may be modified
  backupFile('data.json');
  backupFile('data.tex');
  backupFile('resume-config.json');

  // Import app (doesn't auto-listen due to require.main guard)
  const app = require('../../server');

  // Start on random port
  server = app.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  // Restore backups
  restoreFile('data.json');
  restoreFile('data.tex');
  restoreFile('resume-config.json');

  if (server) {
    server.close(done);
  } else {
    done();
  }
});

// ---- GET /api/documents ----

describe('GET /api/documents', () => {
  test('returns list of document names', async () => {
    const res = await request('GET', '/api/documents');
    expect(res.status).toBe(200);
    expect(res.body).toContain('cv');
    expect(res.body).toContain('coverletter');
  });
});

// ---- GET /api/document/:name ----

describe('GET /api/document/:name', () => {
  test('returns cv document with sections', async () => {
    const res = await request('GET', '/api/document/cv');
    expect(res.status).toBe(200);
    expect(res.body.sections).toBeDefined();
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });

  test('each section has file and enabled fields', async () => {
    const res = await request('GET', '/api/document/cv');
    for (const sec of res.body.sections) {
      expect(sec).toHaveProperty('file');
      expect(sec).toHaveProperty('enabled');
    }
  });

  test('rejects invalid document name', async () => {
    const res = await request('GET', '/api/document/invalid');
    expect(res.status).toBe(400);
  });
});

// ---- GET /api/section/* ----

describe('GET /api/section/*', () => {
  test('returns parsed experience section', async () => {
    const res = await request('GET', '/api/section/cv/experience.tex');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('cventries');
    expect(res.body.title).toBe('Experience');
    expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
  });

  test('returns parsed skills section', async () => {
    const res = await request('GET', '/api/section/cv/skills.tex');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('cvskills');
    expect(res.body.entries.length).toBeGreaterThanOrEqual(5);
  });

  test('returns parsed summary section', async () => {
    const res = await request('GET', '/api/section/cv/summary.tex');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('cvparagraph');
    expect(res.body.text.length).toBeGreaterThan(50);
  });

  test('returns 500 for nonexistent section', async () => {
    const res = await request('GET', '/api/section/cv/nonexistent.tex');
    expect(res.status).toBe(500);
  });
});

// ---- GET/PUT /api/data ----

describe('GET /api/data', () => {
  test('returns personal info and metrics', async () => {
    const res = await request('GET', '/api/data');
    expect(res.status).toBe(200);
    expect(res.body.personal).toBeDefined();
    expect(res.body.metrics).toBeDefined();
    expect(res.body.personal.firstName).toBe('Andrew');
  });

  test('metrics have section field', async () => {
    const res = await request('GET', '/api/data');
    for (const m of res.body.metrics) {
      expect(m).toHaveProperty('section');
      expect(m).toHaveProperty('command');
      expect(m).toHaveProperty('group');
    }
  });
});

describe('PUT /api/data', () => {
  test('saves data and regenerates data.tex', async () => {
    // Get current data
    const getRes = await request('GET', '/api/data');
    const data = getRes.body;

    // Modify a metric value
    const origValue = data.metrics[0].value;
    data.metrics[0].value = 'test-value-42';

    // Save
    const putRes = await request('PUT', '/api/data', data);
    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Verify data.json was updated
    const json = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data.json'), 'utf-8'));
    expect(json.metrics[0].value).toBe('test-value-42');

    // Verify data.tex was regenerated
    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    expect(tex).toContain('test-value-42');

    // Restore original value
    data.metrics[0].value = origValue;
    await request('PUT', '/api/data', data);
  });

  test('rejects invalid data format', async () => {
    const res = await request('PUT', '/api/data', { bad: 'data' });
    expect(res.status).toBe(400);
  });

  test('rejects empty body', async () => {
    const res = await request('PUT', '/api/data', {});
    expect(res.status).toBe(400);
  });
});

// ---- GET/PUT /api/resume-config ----

describe('GET /api/resume-config', () => {
  test('returns config with sectionOrder and sections', async () => {
    const res = await request('GET', '/api/resume-config');
    expect(res.status).toBe(200);
    expect(res.body.sectionOrder).toBeDefined();
    expect(res.body.sections).toBeDefined();
    expect(Array.isArray(res.body.sectionOrder)).toBe(true);
  });
});

describe('PUT /api/resume-config', () => {
  test('saves and retrieves config', async () => {
    const getRes = await request('GET', '/api/resume-config');
    const config = getRes.body;

    // Save same config
    const putRes = await request('PUT', '/api/resume-config', config);
    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Verify it persists
    const getRes2 = await request('GET', '/api/resume-config');
    expect(getRes2.body.sectionOrder).toEqual(config.sectionOrder);
  });
});

// ---- GET /api/coverletter ----

describe('GET /api/coverletter', () => {
  test('returns parsed cover letter', async () => {
    const res = await request('GET', '/api/coverletter');
    expect(res.status).toBe(200);
    expect(res.body.recipient).toBeDefined();
    expect(res.body.opening).toBeDefined();
    expect(res.body.closing).toBeDefined();
    expect(res.body.sections).toBeDefined();
    expect(res.body.sections.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- POST /api/compile/:name ----

describe('POST /api/compile/:name', () => {
  test('compiles CV successfully', async () => {
    const res = await request('POST', '/api/compile/cv');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'cv.pdf'))).toBe(true);
  }, 30000);

  test('compiles resume successfully', async () => {
    const res = await request('POST', '/api/compile/resume');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'resume.pdf'))).toBe(true);
  }, 30000);

  test('compiles cover letter successfully', async () => {
    const res = await request('POST', '/api/compile/coverletter');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'coverletter.pdf'))).toBe(true);
  }, 30000);

  test('rejects invalid document name', async () => {
    const res = await request('POST', '/api/compile/invalid');
    expect(res.status).toBe(400);
  });
});

// ---- GET /api/pdf/:name ----

describe('GET /api/pdf/:name', () => {
  test('serves compiled CV PDF', async () => {
    // Compile first to ensure PDF exists
    await request('POST', '/api/compile/cv');

    const res = await request('GET', '/api/pdf/cv');
    expect(res.status).toBe(200);
  }, 30000);

  test('rejects invalid document name', async () => {
    const res = await request('GET', '/api/pdf/invalid');
    expect(res.status).toBe(400);
  });
});
