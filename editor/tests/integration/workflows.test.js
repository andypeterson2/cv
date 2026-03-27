/**
 * Cross-endpoint workflow integration tests for the CV Editor.
 *
 * Tests multi-step operations that span several API endpoints:
 * section roundtrips, resume filtering, data↔tex consistency,
 * document section ordering, cover letter workflows, and security.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
let server;
let port;

// ── HTTP helper ─────────────────────────────────────────────────────────────

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── File backup / restore ───────────────────────────────────────────────────

const BACKUPS = [
  'data.json',
  'data.tex',
  'resume-config.json',
  'cv.tex',
  'resume.tex',
  'coverletter.tex',
];

function backupFile(rel) {
  const full = path.join(PROJECT_ROOT, rel);
  if (fs.existsSync(full)) fs.copyFileSync(full, full + '.wf-backup');
}

function restoreFile(rel) {
  const full = path.join(PROJECT_ROOT, rel);
  const bak = full + '.wf-backup';
  if (fs.existsSync(bak)) {
    fs.copyFileSync(bak, full);
    fs.unlinkSync(bak);
  }
}

// Also backup any cv/*.tex files that get modified
const CV_TEX_DIR = path.join(PROJECT_ROOT, 'cv');
let backedUpSections = [];

function backupSection(filename) {
  const full = path.join(CV_TEX_DIR, filename);
  if (fs.existsSync(full) && !backedUpSections.includes(filename)) {
    fs.copyFileSync(full, full + '.wf-backup');
    backedUpSections.push(filename);
  }
}

function restoreSections() {
  for (const filename of backedUpSections) {
    const full = path.join(CV_TEX_DIR, filename);
    const bak = full + '.wf-backup';
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, full);
      fs.unlinkSync(bak);
    }
  }
  backedUpSections = [];
}

// ── Server lifecycle ────────────────────────────────────────────────────────

beforeAll((done) => {
  BACKUPS.forEach(backupFile);
  const app = require('../../server');
  server = app.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  restoreSections();
  BACKUPS.forEach(restoreFile);
  if (server) server.close(done);
  else done();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Section GET → PUT → GET roundtrips (every section type)
// ═════════════════════════════════════════════════════════════════════════════

describe('Section API roundtrips', () => {
  const SECTIONS = [
    { file: 'cv/experience.tex', type: 'cventries' },
    { file: 'cv/skills.tex', type: 'cvskills' },
    { file: 'cv/summary.tex', type: 'cvparagraph' },
    { file: 'cv/certifications.tex', type: 'cvhonors' },
    { file: 'cv/education.tex', type: 'cventries' },
  ];

  test.each(SECTIONS)(
    'GET → PUT → GET roundtrip for $file ($type)',
    async ({ file, type }) => {
      backupSection(path.basename(file));

      // 1. Read original
      const get1 = await request('GET', `/api/section/${file}`);
      expect(get1.status).toBe(200);
      expect(get1.body.type).toBe(type);

      // 2. Write it back unchanged
      const put = await request('PUT', `/api/section/${file}`, get1.body);
      expect(put.status).toBe(200);
      expect(put.body.success).toBe(true);

      // 3. Re-read and compare structure
      const get2 = await request('GET', `/api/section/${file}`);
      expect(get2.status).toBe(200);
      expect(get2.body.type).toBe(get1.body.type);
      expect(get2.body.title).toBe(get1.body.title);

      if (type === 'cventries' || type === 'cvskills' || type === 'cvhonors') {
        expect(get2.body.entries.length).toBe(get1.body.entries.length);
      }
      if (type === 'cvparagraph') {
        // Whitespace may normalize; check content is preserved
        expect(get2.body.text.trim().length).toBeGreaterThan(0);
      }
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Section modification: edit entry, save, verify persistence
// ═════════════════════════════════════════════════════════════════════════════

describe('Section modification workflow', () => {
  test('modify experience entry position, verify it persists', async () => {
    backupSection('experience.tex');

    // Read
    const get1 = await request('GET', '/api/section/cv/experience.tex');
    expect(get1.status).toBe(200);
    const data = get1.body;
    const origPosition = data.entries[0].position;

    // Modify
    data.entries[0].position = 'Integration Test Position';
    const put = await request('PUT', '/api/section/cv/experience.tex', data);
    expect(put.status).toBe(200);

    // Verify via API
    const get2 = await request('GET', '/api/section/cv/experience.tex');
    expect(get2.body.entries[0].position).toBe('Integration Test Position');

    // Verify on disk
    const tex = fs.readFileSync(path.join(CV_TEX_DIR, 'experience.tex'), 'utf-8');
    expect(tex).toContain('Integration Test Position');

    // Restore
    data.entries[0].position = origPosition;
    await request('PUT', '/api/section/cv/experience.tex', data);
  });

  test('add a bullet point to experience entry', async () => {
    backupSection('experience.tex');

    const get1 = await request('GET', '/api/section/cv/experience.tex');
    const data = get1.body;
    const origLen = data.entries[0].items.length;

    data.entries[0].items.push('New integration test bullet point');
    await request('PUT', '/api/section/cv/experience.tex', data);

    const get2 = await request('GET', '/api/section/cv/experience.tex');
    expect(get2.body.entries[0].items.length).toBe(origLen + 1);
    expect(get2.body.entries[0].items).toContain('New integration test bullet point');

    // Restore
    data.entries[0].items.pop();
    await request('PUT', '/api/section/cv/experience.tex', data);
  });

  test('modify skills category, verify persistence', async () => {
    backupSection('skills.tex');

    const get1 = await request('GET', '/api/section/cv/skills.tex');
    const data = get1.body;
    const origCategory = data.entries[0].category;

    data.entries[0].category = 'Test Category';
    await request('PUT', '/api/section/cv/skills.tex', data);

    const get2 = await request('GET', '/api/section/cv/skills.tex');
    expect(get2.body.entries[0].category).toBe('Test Category');

    data.entries[0].category = origCategory;
    await request('PUT', '/api/section/cv/skills.tex', data);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Data ↔ data.tex consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Data JSON ↔ LaTeX consistency', () => {
  test('PUT /api/data regenerates data.tex with all personal fields', async () => {
    const get1 = await request('GET', '/api/data');
    const data = get1.body;

    // Modify and save
    data.personal.firstName = 'TestFirst';
    data.personal.lastName = 'TestLast';
    await request('PUT', '/api/data', data);

    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    expect(tex).toContain('TestFirst');
    expect(tex).toContain('TestLast');

    // Restore
    data.personal.firstName = 'Andrew';
    data.personal.lastName = 'Peterson';
    await request('PUT', '/api/data', data);
  });

  test('metric with null value generates TBD placeholder in data.tex', async () => {
    const get1 = await request('GET', '/api/data');
    const data = get1.body;
    const origValue = data.metrics[0].value;
    const label = data.metrics[0].label;

    data.metrics[0].value = null;
    await request('PUT', '/api/data', data);

    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    expect(tex).toContain('\\tbd{');

    // Restore
    data.metrics[0].value = origValue;
    await request('PUT', '/api/data', data);
  });

  test('every metric command appears in data.tex', async () => {
    const get1 = await request('GET', '/api/data');
    const data = get1.body;

    // Force regenerate
    await request('PUT', '/api/data', data);

    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'data.tex'), 'utf-8');
    for (const m of data.metrics) {
      expect(tex).toContain(`\\${m.command}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Resume filtering pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('Resume config ↔ section filtering', () => {
  test('resume-config sectionOrder files all exist on disk', async () => {
    const res = await request('GET', '/api/resume-config');
    expect(res.status).toBe(200);

    for (const file of res.body.sectionOrder) {
      const full = path.join(PROJECT_ROOT, file);
      expect(fs.existsSync(full)).toBe(true);
    }
  });

  test('resume-config sections keys match sectionOrder entries', async () => {
    const res = await request('GET', '/api/resume-config');
    const { sectionOrder, sections } = res.body;

    // Every file in sectionOrder should have a config entry
    // Use array form because paths with '/' are interpreted as nested by Jest
    for (const file of sectionOrder) {
      expect(sections).toHaveProperty([file]);
    }
  });

  test('toggle resume section off and verify config persists', async () => {
    const get1 = await request('GET', '/api/resume-config');
    const config = get1.body;
    const firstFile = config.sectionOrder[0];
    const origResume = config.sections[firstFile].resume;

    // Toggle off
    config.sections[firstFile].resume = false;
    const put = await request('PUT', '/api/resume-config', config);
    expect(put.status).toBe(200);

    // Verify
    const get2 = await request('GET', '/api/resume-config');
    expect(get2.body.sections[firstFile].resume).toBe(false);

    // Restore
    config.sections[firstFile].resume = origResume;
    await request('PUT', '/api/resume-config', config);
  });

  test('PUT resume-config rejects missing sectionOrder', async () => {
    const res = await request('PUT', '/api/resume-config', { sections: {} });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Document section ordering
// ═════════════════════════════════════════════════════════════════════════════

describe('Document section ordering', () => {
  test('GET /api/document/cv sections match .tex \\input lines', async () => {
    const res = await request('GET', '/api/document/cv');
    expect(res.status).toBe(200);

    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'cv.tex'), 'utf-8');
    for (const sec of res.body.sections) {
      // Each section file should appear in the .tex as \input{...}
      const basename = sec.file.replace('.tex', '');
      expect(tex).toContain(basename);
    }
  });

  test('PUT section order accepts valid sections', async () => {
    const get1 = await request('GET', '/api/document/cv');
    const sections = get1.body.sections;

    // PUT the current sections back — should succeed
    const put = await request('PUT', '/api/document/cv/sections', { sections });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
  });

  test('disable a section and verify it appears commented out', async () => {
    const get1 = await request('GET', '/api/document/cv');
    const sections = get1.body.sections;
    const origEnabled = sections[0].enabled;

    // Disable first section
    sections[0].enabled = false;
    await request('PUT', '/api/document/cv/sections', { sections });

    // Verify on disk: should be commented
    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'cv.tex'), 'utf-8');
    const basename = sections[0].file.replace('.tex', '');
    // The line with this section should be commented
    const lines = tex.split('\n');
    const sectionLine = lines.find((l) => l.includes(basename));
    expect(sectionLine).toBeDefined();
    expect(sectionLine.trimStart().startsWith('%')).toBe(true);

    // Restore
    sections[0].enabled = origEnabled;
    await request('PUT', '/api/document/cv/sections', { sections });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Cover letter workflow
// ═════════════════════════════════════════════════════════════════════════════

describe('Cover letter roundtrip', () => {
  test('GET → PUT → GET preserves cover letter structure', async () => {
    const get1 = await request('GET', '/api/coverletter');
    expect(get1.status).toBe(200);

    const put = await request('PUT', '/api/coverletter', get1.body);
    expect(put.status).toBe(200);

    const get2 = await request('GET', '/api/coverletter');
    expect(get2.body.recipient).toEqual(get1.body.recipient);
    expect(get2.body.opening).toEqual(get1.body.opening);
    expect(get2.body.closing).toEqual(get1.body.closing);
    expect(get2.body.sections.length).toBe(get1.body.sections.length);
  });

  test('modify cover letter recipient and verify persistence', async () => {
    const get1 = await request('GET', '/api/coverletter');
    const data = get1.body;
    const origName = data.recipient.name;

    data.recipient.name = 'Test Recipient Corp';
    await request('PUT', '/api/coverletter', data);

    const get2 = await request('GET', '/api/coverletter');
    expect(get2.body.recipient.name).toBe('Test Recipient Corp');

    // Verify on disk
    const tex = fs.readFileSync(path.join(PROJECT_ROOT, 'coverletter.tex'), 'utf-8');
    expect(tex).toContain('Test Recipient Corp');

    // Restore
    data.recipient.name = origName;
    await request('PUT', '/api/coverletter', data);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Cross-endpoint: data + section consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Cross-endpoint data consistency', () => {
  test('metrics section field references valid section files', async () => {
    const dataRes = await request('GET', '/api/data');
    const docRes = await request('GET', '/api/document/cv');

    const sectionFiles = docRes.body.sections.map((s) => s.file);

    for (const metric of dataRes.body.metrics) {
      if (metric.section) {
        expect(sectionFiles).toContain(metric.section);
      }
    }
  });

  test('all CV section files are parseable via API', async () => {
    const docRes = await request('GET', '/api/document/cv');

    for (const sec of docRes.body.sections) {
      const res = await request('GET', `/api/section/${sec.file}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBeDefined();
      expect(res.body.title).toBeDefined();
    }
  });

  test('resume-config entries match actual entry counts', async () => {
    const configRes = await request('GET', '/api/resume-config');
    const config = configRes.body;

    for (const file of config.sectionOrder) {
      const secConfig = config.sections[file];
      if (!secConfig || !secConfig.entries) continue;

      const secRes = await request('GET', `/api/section/${file}`);
      if (secRes.status !== 200 || !secRes.body.entries) continue;

      // Config entries count should match actual entries count
      expect(secConfig.entries.length).toBe(secRes.body.entries.length);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Security: path traversal
// ═════════════════════════════════════════════════════════════════════════════

describe('Path traversal protection', () => {
  test('rejects ../ in section path', async () => {
    const res = await request('GET', '/api/section/../../../etc/passwd');
    expect(res.status).toBe(500);
  });

  test('rejects non-.tex files', async () => {
    const res = await request('GET', '/api/section/cv/experience.js');
    expect(res.status).toBe(400);
  });

  test('rejects invalid document name', async () => {
    const res = await request('GET', '/api/document/evil');
    expect(res.status).toBe(400);
  });

  test('rejects invalid compile name', async () => {
    const res = await request('POST', '/api/compile/evil');
    expect(res.status).toBe(400);
  });

  test('rejects invalid pdf name', async () => {
    const res = await request('GET', '/api/pdf/evil');
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Error handling
// ═════════════════════════════════════════════════════════════════════════════

describe('Error handling', () => {
  test('PUT /api/section with empty body returns 500', async () => {
    const res = await request('PUT', '/api/section/cv/experience.tex', {});
    expect(res.status).toBe(500);
  });

  test('PUT /api/data with string metrics returns 400', async () => {
    const res = await request('PUT', '/api/data', {
      personal: { firstName: 'Test' },
      metrics: 'not-an-array',
    });
    expect(res.status).toBe(400);
  });

  test('PUT /api/resume-config with null body returns 400', async () => {
    const res = await request('PUT', '/api/resume-config', null);
    // Express may parse null differently; expect 400 or 500
    expect([400, 500]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Static file serving
// ═════════════════════════════════════════════════════════════════════════════

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

  test('serves style.css', async () => {
    const res = await request('GET', '/style.css');
    expect(res.status).toBe(200);
  });
});
