const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const CvDatabase = require('./lib/db');
const { validate, isValidVariant } = require('./lib/schema');
const { generateAll } = require('./lib/generator');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');

// Database: use env var, test override, or default location
const DB_PATH = process.env.CV_DB_PATH || path.join(PROJECT_ROOT, 'cv.db');
let db;

function getDb() {
  if (!db) {
    db = new CvDatabase(DB_PATH);
  }
  return db;
}

// Allow tests to inject an in-memory DB
app.setDb = function (testDb) {
  db = testDb;
};

app.getDb = function () {
  return getDb();
};

app.use(cors({
  origin: process.env.CV_CORS_ORIGINS
    ? process.env.CV_CORS_ORIGINS.split(',')
    : ['http://localhost:3001', 'http://127.0.0.1:3001', 'https://andypeterson2.github.io', 'https://andypeterson.dev']
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: resolve a .tex file path safely within the project root
function texPath(relPath) {
  const resolved = path.resolve(PROJECT_ROOT, relPath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error('Path traversal attempt');
  }
  return resolved;
}

const RESUME_CONFIG_PATH = path.join(PROJECT_ROOT, 'resume-config.json');
const DATA_JSON_PATH = path.join(PROJECT_ROOT, 'data.json');

function readResumeConfig() {
  try { return JSON.parse(fs.readFileSync(RESUME_CONFIG_PATH, 'utf-8')); }
  catch (e) { return { sectionOrder: [], sections: {} }; }
}

function readDataJson() {
  try { return JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8')); }
  catch (e) { return { personal: {}, metrics: [] }; }
}

// ---------------------------------------------------------------------------
// GET /api/seed — parse all .tex files into a single JSON state
// Called once on first visit (or when user clicks "Reset from server")
// ---------------------------------------------------------------------------

app.get('/api/seed', (req, res) => {
  try {
    // Document structure from cv.tex
    const cvTex = fs.readFileSync(texPath('cv.tex'), 'utf-8');
    const document = parseDocument(cvTex);

    // Parse each section file
    const sectionData = {};
    for (const sec of document.sections) {
      try {
        const secTex = fs.readFileSync(texPath(sec.file), 'utf-8');
        const parsed = parseSection(secTex);
        parsed.file = sec.file;
        sectionData[sec.file] = parsed;
      } catch (e) {
        // Section file missing — skip
      }
    }

    // Personal data + metrics
    const data = readDataJson();

    // Resume config
    const resumeConfig = readResumeConfig();

    // Cover letter
    let coverletter = null;
    try {
      const clTex = fs.readFileSync(texPath('coverletter.tex'), 'utf-8');
      coverletter = parseCoverletter(clTex);
    } catch (e) { /* no coverletter.tex */ }

    res.json({ data, resumeConfig, coverletter, document, sectionData });
  } catch (e) {
    res.status(500).json({ error: 'Seed failed: ' + e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/compile/:name — receive full JSON state, generate .tex, compile
// ---------------------------------------------------------------------------

function writeDataTex(data) {
  const serialized = serializeData(data);
  fs.writeFileSync(texPath('data.tex'), serialized + '\n', 'utf-8');
}

function generateResumeFiles(state) {
  const config = state.resumeConfig;
  const resumeDir = path.join(PROJECT_ROOT, 'resume');

  if (!fs.existsSync(resumeDir)) {
    fs.mkdirSync(resumeDir, { recursive: true });
  }

  const resumeSections = [];
  for (const cvFile of (config.sectionOrder || [])) {
    const secConfig = config.sections[cvFile];
    if (!secConfig || secConfig.resume === false) continue;

    const sectionData = state.sectionData[cvFile];
    if (!sectionData) continue;

    const filtered = serializeFilteredSection(sectionData, secConfig);
    const filename = path.basename(cvFile);
    fs.writeFileSync(path.join(resumeDir, filename), filtered + '\n', 'utf-8');

    resumeSections.push({ file: `resume/${filename}`, enabled: true, comment: '' });
  }
});

app.delete('/api/entries/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().deleteEntry(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/sections/:id/entries/order', validate('reorder'), (req, res) => {
  try {
    getDb().reorderEntries(req.params.id, req.body.ids);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Items (bullet points)
// ---------------------------------------------------------------------------

app.post('/api/entries/:id/items', validate('createItem'), (req, res) => {
  try {
    const entryId = parseInt(req.params.id, 10);
    const itemId = getDb().createItem(entryId, req.body.content);
    res.status(201).json({ id: Number(itemId) });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/items/:id', validate('updateItem'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().updateItem(id, {
      content: req.body.content,
      resumeIncluded: req.body.resumeIncluded,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/items/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().deleteItem(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/entries/:id/items/order', validate('reorder'), (req, res) => {
  try {
    const entryId = parseInt(req.params.id, 10);
    getDb().reorderItems(entryId, req.body.ids);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

app.get('/api/metrics', (req, res) => {
  try {
    const sectionId = req.query.section || null;
    res.json(getDb().getMetrics(sectionId));
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/metrics', validate('createMetric'), (req, res) => {
  try {
    const id = getDb().createMetric({
      command: req.body.command,
      label: req.body.label || '',
      value: req.body.value ?? null,
      groupName: req.body.groupName || '',
      sectionId: req.body.sectionId,
    });
    res.status(201).json({ id: Number(id) });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Metric command already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/metrics/:id', validate('updateMetric'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getDb().getMetrics().find(m => m.id === id);
    if (!existing) return res.status(404).json({ error: 'Metric not found' });
    getDb().updateMetric(id, {
      command: req.body.command ?? existing.command,
      label: req.body.label ?? existing.label,
      value: req.body.value !== undefined ? req.body.value : existing.value,
      groupName: req.body.groupName ?? existing.groupName,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Metric command already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/metrics/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().deleteMetric(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Documents (per-variant section ordering)
// ---------------------------------------------------------------------------

app.get('/api/documents', (req, res) => {
  res.json(['cv', 'resume', 'coverletter']);
});

app.get('/api/documents/:variant', (req, res) => {
  const { variant } = req.params;
  if (!isValidVariant(variant)) {
    return res.status(400).json({ error: 'Invalid variant' });
  }
  try {
    res.json({ variant, sections: getDb().getDocumentSections(variant) });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/documents/:variant', validate('documentSections'), (req, res) => {
  const { variant } = req.params;
  if (!isValidVariant(variant)) {
    return res.status(400).json({ error: 'Invalid variant' });
  }
  try {
    getDb().setDocumentSections(variant, req.body.sections);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Cover letter sections
// ---------------------------------------------------------------------------

app.get('/api/coverletter/sections', (req, res) => {
  try {
    res.json(getDb().getCoverletterSections());
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/coverletter/sections', validate('createCoverletterSection'), (req, res) => {
  try {
    const id = getDb().createCoverletterSection(req.body.title, req.body.body);
    res.status(201).json({ id: Number(id) });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/coverletter/sections/:id', validate('updateCoverletterSection'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getDb().getCoverletterSections().find(s => s.id === id);
    if (!existing) return res.status(404).json({ error: 'Section not found' });
    getDb().updateCoverletterSection(id, {
      title: req.body.title ?? existing.title,
      body: req.body.body ?? existing.body,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/coverletter/sections/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().deleteCoverletterSection(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/coverletter/sections/order', validate('reorder'), (req, res) => {
  try {
    getDb().reorderCoverletterSections(req.body.ids);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Persons
// ---------------------------------------------------------------------------

app.get('/api/persons', (req, res) => {
  try {
    const persons = getDb().getPersons();
    const activePersonId = getDb().getActivePersonId();
    res.json({ persons, activePersonId });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/persons', validate('createPerson'), (req, res) => {
  try {
    const id = getDb().createPerson(req.body.name);
    res.status(201).json({ id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Person with that name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/persons/:id', validate('updatePerson'), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    getDb().renamePerson(id, req.body.name);
    res.json({ success: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Person with that name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/persons/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    getDb().deletePerson(id);
    res.json({ success: true });
  } catch (e) {
    if (e.message && e.message.includes('Cannot delete')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/persons/:id/switch', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    getDb().switchPerson(id);
    res.json({ success: true });
  } catch (e) {
    if (e.message && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

app.post('/api/import', validate('importData'), (req, res) => {
  try {
    getDb().importAll(req.body);
    // Also update the active person's data blob
    const activeId = getDb().getActivePersonId();
    if (activeId) {
      getDb().savePerson(activeId);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Compile + PDF
// ---------------------------------------------------------------------------

app.post('/api/compile/:variant', (req, res) => {
  const { variant } = req.params;
  if (!isValidVariant(variant)) {
    return res.status(400).json({ error: 'Invalid variant' });
  }

  const state = req.body;
  if (!state || !state.data || !state.sectionData) {
    return res.status(400).json({ error: 'Missing state in request body' });
  }

  try {
    // 1. Write data.tex + data.json
    writeDataTex(state.data);
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(state.data, null, 2) + '\n', 'utf-8');

    // 2. Write section .tex files
    for (const [file, sectionJson] of Object.entries(state.sectionData)) {
      try {
        const resolved = texPath(file);
        if (!resolved.endsWith('.tex')) continue;
        const serialized = serializeSection(sectionJson);
        fs.writeFileSync(resolved, serialized + '\n', 'utf-8');
      } catch (e) { /* skip invalid paths */ }
    }

    // 3. Update cv.tex \input lines from document structure
    if (state.document && state.document.sections) {
      const cvTexPath = texPath('cv.tex');
      const cvTex = fs.readFileSync(cvTexPath, 'utf-8');
      const updatedCv = serializeDocumentSections(cvTex, state.document.sections);
      fs.writeFileSync(cvTexPath, updatedCv, 'utf-8');
    }

    // 4. Write resume-config.json
    if (state.resumeConfig) {
      fs.writeFileSync(RESUME_CONFIG_PATH, JSON.stringify(state.resumeConfig, null, 2) + '\n', 'utf-8');
    }

    // 5. For resume: generate filtered resume/ files
    if (name === 'resume') {
      generateResumeFiles(state);
    }

    // 6. For coverletter: update coverletter.tex
    if (name === 'coverletter' && state.coverletter) {
      const clPath = texPath('coverletter.tex');
      const clTex = fs.readFileSync(clPath, 'utf-8');
      const updatedCl = serializeCoverletter(clTex, state.coverletter);
      fs.writeFileSync(clPath, updatedCl, 'utf-8');
    }
  } catch (e) {
    return res.status(500).json({ success: false, log: 'File generation failed: ' + e.message });
  }

  execFile('xelatex', ['--no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], {
    cwd: PROJECT_ROOT,
    timeout: 30000
  }, (error, stdout, stderr) => {
    const pdfExists = fs.existsSync(path.join(PROJECT_ROOT, `${name}.pdf`));
    res.json({
      success: !error && pdfExists,
      log: stdout + (stderr ? '\n' + stderr : ''),
      pdfPath: pdfExists ? `/api/pdf/${name}` : null
    });
    }); // fc-cache callback
  } catch (e) {
    res.status(500).json({ success: false, log: 'Generation failed: ' + e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pdf/:name — serve compiled PDF
// ---------------------------------------------------------------------------

app.get('/api/pdf/:name', (req, res) => {
  const name = req.params.name;
  if (!['resume', 'cv', 'coverletter'].includes(name)) {
    return res.status(400).json({ error: 'Invalid document name' });
  }
  const pdfPath = path.join(PROJECT_ROOT, 'build', variant, `${variant}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'PDF not found. Compile first.' });
  }
  res.sendFile(pdfPath);
});

// ---------------------------------------------------------------------------
// Export + Health
// ---------------------------------------------------------------------------

app.get('/api/export', (req, res) => {
  try {
    res.json(getDb().getAllForExport());
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  try {
    // Simple DB health check — run a trivial query
    const sections = getDb().getSections();
    res.json({ status: 'ok', service: 'cv', sections: sections.length });
  } catch (e) {
    res.status(500).json({ status: 'error', service: 'cv', error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`CV Editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
    console.log(`Database: ${DB_PATH}`);
  });
}

module.exports = app;
