const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const CvDatabase = require('./lib/db');
const { parseDocument, parseSection, parseCoverletter } = require('./lib/parser');

// Route modules
const createSettingsRouter = require('./routes/settings');
const createSectionsRouter = require('./routes/sections');
const createEntriesRouter = require('./routes/entries');
const createItemsRouter = require('./routes/items');
const createDocumentsRouter = require('./routes/documents');
const createCoverletterRouter = require('./routes/coverletter');
const createPersonsRouter = require('./routes/persons');
const createDataRouter = require('./routes/data');
const createCompileRouter = require('./routes/compile');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
    : ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost:4322', 'http://127.0.0.1:4322', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Mount routers
// ---------------------------------------------------------------------------

app.use('/api/settings', createSettingsRouter(getDb));
app.use('/api/sections', createSectionsRouter(getDb));
app.use('/api/entries', createEntriesRouter(getDb));
app.use('/api/items', createItemsRouter(getDb));
app.use('/api/documents', createDocumentsRouter(getDb));
app.use('/api/coverletter/sections', createCoverletterRouter(getDb));
app.use('/api/persons', createPersonsRouter(getDb));
app.use('/api', createDataRouter(getDb));
app.use('/api', createCompileRouter(getDb, PROJECT_ROOT));

// ---------------------------------------------------------------------------
// GET /api/seed — parse .tex files into JSON state
// ---------------------------------------------------------------------------

function texPath(relPath) {
  const resolved = path.resolve(PROJECT_ROOT, relPath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error('Path traversal attempt');
  }
  return resolved;
}

const DATA_JSON_PATH = path.join(PROJECT_ROOT, 'data.json');
const RESUME_CONFIG_PATH = path.join(PROJECT_ROOT, 'resume-config.json');

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
    let data;
    try { data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8')); }
    catch (e) { data = { personal: {}, metrics: [] }; }

    // Resume config
    let resumeConfig;
    try { resumeConfig = JSON.parse(fs.readFileSync(RESUME_CONFIG_PATH, 'utf-8')); }
    catch (e) { resumeConfig = { sectionOrder: [], sections: {} }; }

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
// Error handling middleware
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const body = { error: err.message || 'Internal server error' };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
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
