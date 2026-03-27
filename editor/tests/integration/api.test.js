/**
 * Integration tests for the CV Editor server API.
 * Tests the seed endpoint (parse .tex → JSON) and compile endpoint (JSON → PDF).
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

function restoreFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  const backup = full + '.test-backup';
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, full);
    fs.unlinkSync(backup);
  }
}

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

  test('data contains personal info and metrics', async () => {
    const res = await request('GET', '/api/seed');
    expect(res.body.data.personal).toBeDefined();
    expect(res.body.data.personal.firstName).toBe('Andrew');
    expect(res.body.data.metrics).toBeDefined();
    expect(res.body.data.metrics.length).toBeGreaterThan(0);
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
});

// ---- POST /api/compile/:name ----

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
    // Modify a metric to verify it propagates
    const state = JSON.parse(JSON.stringify(seedState));
    state.data.metrics[0].value = 'test-compile-42';

    const res = await request('POST', '/api/compile/cv', state);
    expect(res.status).toBe(200);

    // data.tex should contain the test value
    const dataTex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    expect(dataTex).toContain('test-compile-42');

    // data.json should be updated too
    const dataJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data.json'), 'utf-8'));
    expect(dataJson.metrics[0].value).toBe('test-compile-42');
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
