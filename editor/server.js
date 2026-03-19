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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: resolve a .tex file path safely within the project root
function texPath(relPath) {
  const resolved = path.resolve(PROJECT_ROOT, relPath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error('Path traversal attempt');
  }
  return resolved;
}

const RESUME_CONFIG_PATH = path.join(PROJECT_ROOT, 'resume-config.json');

function readResumeConfig() {
  try {
    return JSON.parse(fs.readFileSync(RESUME_CONFIG_PATH, 'utf-8'));
  } catch (e) {
    return { sectionOrder: [], sections: {} };
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

app.get('/api/documents', (req, res) => {
  res.json(['cv', 'coverletter']);
});

app.get('/api/document/:name', (req, res) => {
  const name = req.params.name;
  if (!['resume', 'cv'].includes(name)) {
    return res.status(400).json({ error: 'Invalid document name' });
  }
  try {
    const tex = fs.readFileSync(texPath(`${name}.tex`), 'utf-8');
    const result = parseDocument(tex);
    result.document = name;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/document/:name/sections', (req, res) => {
  const name = req.params.name;
  if (!['resume', 'cv'].includes(name)) {
    return res.status(400).json({ error: 'Invalid document name' });
  }
  try {
    const filePath = texPath(`${name}.tex`);
    const tex = fs.readFileSync(filePath, 'utf-8');
    const updated = serializeDocumentSections(tex, req.body.sections);
    fs.writeFileSync(filePath, updated, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

app.get('/api/section/*', (req, res) => {
  const relPath = req.params[0];
  try {
    const tex = fs.readFileSync(texPath(relPath), 'utf-8');
    const parsed = parseSection(tex);
    parsed.file = relPath;
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/section/*', (req, res) => {
  const relPath = req.params[0];
  try {
    const serialized = serializeSection(req.body);
    fs.writeFileSync(texPath(relPath), serialized + '\n', 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// data.json (source of truth) → generates data.tex
// ---------------------------------------------------------------------------

const DATA_JSON_PATH = path.join(PROJECT_ROOT, 'data.json');

function readDataJson() {
  try {
    return JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
  } catch (e) {
    return { personal: {}, metrics: [] };
  }
}

function writeDataJson(data) {
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function generateDataTex(data) {
  const serialized = serializeData(data);
  fs.writeFileSync(texPath('data.tex'), serialized + '\n', 'utf-8');
}

app.get('/api/data', (req, res) => {
  try {
    res.json(readDataJson());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/data', (req, res) => {
  try {
    if (!req.body || !req.body.personal || !Array.isArray(req.body.metrics)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    writeDataJson(req.body);
    generateDataTex(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Resume config
// ---------------------------------------------------------------------------

app.get('/api/resume-config', (req, res) => {
  res.json(readResumeConfig());
});

app.put('/api/resume-config', (req, res) => {
  try {
    fs.writeFileSync(RESUME_CONFIG_PATH, JSON.stringify(req.body, null, 2) + '\n', 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

app.get('/api/coverletter', (req, res) => {
  try {
    const tex = fs.readFileSync(texPath('coverletter.tex'), 'utf-8');
    res.json(parseCoverletter(tex));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/coverletter', (req, res) => {
  try {
    const filePath = texPath('coverletter.tex');
    const tex = fs.readFileSync(filePath, 'utf-8');
    const updated = serializeCoverletter(tex, req.body);
    fs.writeFileSync(filePath, updated, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

// Generate filtered resume/ files from cv/ master + resume-config
function generateResumeFiles() {
  const config = readResumeConfig();
  const resumeDir = path.join(PROJECT_ROOT, 'resume');

  // Ensure resume/ directory exists
  if (!fs.existsSync(resumeDir)) {
    fs.mkdirSync(resumeDir, { recursive: true });
  }

  // Build resume section list from config's sectionOrder
  const resumeSections = [];
  for (const cvFile of (config.sectionOrder || [])) {
    const secConfig = config.sections[cvFile];
    if (!secConfig || secConfig.resume === false) continue;

    // Read and parse the cv/ master file
    const cvPath = texPath(cvFile);
    if (!fs.existsSync(cvPath)) continue;

    const tex = fs.readFileSync(cvPath, 'utf-8');
    const parsed = parseSection(tex);

    // Serialize with filtering
    const filtered = serializeFilteredSection(parsed, secConfig);

    // Write to resume/ directory (cv/foo.tex -> resume/foo.tex)
    const filename = path.basename(cvFile);
    const resumeFilePath = path.join(resumeDir, filename);
    fs.writeFileSync(resumeFilePath, filtered + '\n', 'utf-8');

    resumeSections.push({
      file: `resume/${filename}`,
      enabled: true,
      comment: ''
    });
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

  try {
    // Always regenerate data.tex from data.json before compiling
    generateDataTex(readDataJson());

    // For resume: generate filtered files first
    if (name === 'resume') {
      generateResumeFiles();
    }
  } catch (e) {
    return res.status(500).json({ success: false, log: 'Resume generation failed: ' + e.message });
  }

  execFile('xelatex', ['-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], {
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

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CV Editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
  });
}

module.exports = app;
