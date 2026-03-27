const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { parseSection, parseDocument, parseCoverletter } = require('./lib/parser');
const { serializeSection, serializeFilteredSection, serializeDocumentSections, serializeData, serializeCoverletter } = require('./lib/serializer');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');

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

  // Rewrite resume.tex \input lines
  const resumeTexPath = texPath('resume.tex');
  const resumeTex = fs.readFileSync(resumeTexPath, 'utf-8');
  const updated = serializeDocumentSections(resumeTex, resumeSections);
  fs.writeFileSync(resumeTexPath, updated, 'utf-8');
}

app.post('/api/compile/:name', (req, res) => {
  const name = req.params.name;
  if (!['resume', 'cv', 'coverletter'].includes(name)) {
    return res.status(400).json({ error: 'Invalid document name' });
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
  });
});

// ---------------------------------------------------------------------------
// GET /api/pdf/:name — serve compiled PDF
// ---------------------------------------------------------------------------

app.get('/api/pdf/:name', (req, res) => {
  const name = req.params.name;
  if (!['resume', 'cv', 'coverletter'].includes(name)) {
    return res.status(400).json({ error: 'Invalid document name' });
  }
  const pdfPath = path.join(PROJECT_ROOT, `${name}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'PDF not found. Compile first.' });
  }
  res.sendFile(pdfPath);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`CV Editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
  });
}

module.exports = app;
