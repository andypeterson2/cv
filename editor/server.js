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
    : ['http://localhost:3001', 'http://127.0.0.1:3001', 'https://andypeterson2.github.io']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Settings (personal info, coverletter header)
// ---------------------------------------------------------------------------

app.get('/api/settings', (req, res) => {
  try {
    const prefix = req.query.prefix;
    res.json(getDb().getSettings(prefix));
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/settings', validate('settings'), (req, res) => {
  try {
    getDb().setSettings(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

app.get('/api/sections', (req, res) => {
  try {
    res.json(getDb().getSections());
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/sections/:id', (req, res) => {
  try {
    const section = getDb().getSection(req.params.id);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    res.json(section);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sections', validate('createSection'), (req, res) => {
  try {
    getDb().createSection(req.body.id, req.body.type, req.body.title);
    res.status(201).json({ id: req.body.id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Section already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/sections/:id', validate('updateSection'), (req, res) => {
  try {
    const section = getDb().getSection(req.params.id);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    getDb().updateSection(req.params.id, { title: req.body.title });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/sections/:id', (req, res) => {
  try {
    const section = getDb().getSection(req.params.id);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    getDb().deleteSection(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

app.post('/api/sections/:id/entries', validate('createEntry'), (req, res) => {
  try {
    const section = getDb().getSection(req.params.id);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    const entryId = getDb().createEntry(req.params.id, req.body.fields);
    res.status(201).json({ id: Number(entryId) });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/entries/:id', validate('updateEntry'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    getDb().updateEntry(id, {
      fields: req.body.fields,
      resumeIncluded: req.body.resumeIncluded,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
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
// Compile + PDF
// ---------------------------------------------------------------------------

app.post('/api/compile/:variant', (req, res) => {
  const { variant } = req.params;
  if (!isValidVariant(variant)) {
    return res.status(400).json({ error: 'Invalid variant' });
  }

  try {
    const compileData = getDb().getAllForCompile(variant);
    const buildDir = path.join(PROJECT_ROOT, 'build', variant);
    const mainTexFile = generateAll(compileData, buildDir, TEMPLATES_DIR, ASSETS_DIR);

    execFile('xelatex', [
      '--no-shell-escape',
      '-interaction=nonstopmode',
      '-halt-on-error',
      path.basename(mainTexFile),
    ], {
      cwd: buildDir,
      timeout: 30000,
    }, (error, stdout, stderr) => {
      const pdfName = path.basename(mainTexFile, '.tex') + '.pdf';
      const pdfPath = path.join(buildDir, pdfName);
      const pdfExists = fs.existsSync(pdfPath);
      res.json({
        success: !error && pdfExists,
        log: stdout + (stderr ? '\n' + stderr : ''),
        pdfPath: pdfExists ? `/api/pdf/${variant}` : null,
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, log: 'Generation failed: ' + e.message });
  }
});

app.get('/api/pdf/:variant', (req, res) => {
  const { variant } = req.params;
  if (!isValidVariant(variant)) {
    return res.status(400).json({ error: 'Invalid variant' });
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
    getDb().getSections();
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`CV Editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
    console.log(`Database: ${DB_PATH}`);
  });
}

module.exports = app;
