const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { isValidVariant, VALID_VARIANTS } = require('../lib/schema');
const { AppError, NotFoundError } = require('../lib/errors');

module.exports = function createCompileRouter(getDb, projectRoot) {
  const router = express.Router();
  const TEMPLATES_DIR = path.join(projectRoot, 'templates');
  const ASSETS_DIR = path.join(projectRoot, 'assets');

  router.post('/compile/:variant', (req, res, next) => {
    const { variant } = req.params;
    if (!isValidVariant(variant)) return next(new AppError('Invalid variant', 400));

    const buildDir = path.join(projectRoot, 'build', variant);
    let mainTexFile;
    try {
      const data = getDb().getAllForCompile(variant);
      const { generateAll } = require('../lib/generator');
      mainTexFile = generateAll(data, buildDir, TEMPLATES_DIR, ASSETS_DIR);
    } catch (e) {
      return res.status(500).json({ success: false, log: 'File generation failed: ' + e.message });
    }
    execFile('fc-cache', ['-f', buildDir], { timeout: 5000 }, () => {
    execFile('xelatex', ['--no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', path.basename(mainTexFile)], {
      cwd: buildDir,
      timeout: 30000
    }, (error, stdout, stderr) => {
      const pdfName = path.basename(mainTexFile, '.tex') + '.pdf';
      const pdfPath = path.join(buildDir, pdfName);
      const pdfExists = fs.existsSync(pdfPath);
      res.json({
        success: !error && pdfExists,
        log: stdout + (stderr ? '\n' + stderr : ''),
        pdfPath: pdfExists ? `/api/pdf/${variant}` : null
      });
    });
    }); // fc-cache callback
  });

  router.get('/pdf/:name', (req, res, next) => {
    const name = req.params.name;
    if (!VALID_VARIANTS.includes(name)) return next(new AppError('Invalid document name', 400));
    const pdfPath = path.join(projectRoot, 'build', name, `${name}.pdf`);
    if (!fs.existsSync(pdfPath)) return next(new NotFoundError('PDF not found. Compile first.'));
    res.sendFile(pdfPath);
  });

  // -------------------------------------------------------------------------
  // Per-person variant rendering — compiles a stored person's CV / resume /
  // cover letter on demand without touching the active-person state. Output
  // lives at build/persons/<id>/<variant>/ so concurrent requests for
  // different persons don't clobber each other.
  // -------------------------------------------------------------------------

  function slugifyName(s) {
    return String(s || 'document')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document';
  }

  function cleanupDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  router.get('/persons/:id/pdf/:variant', (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { variant } = req.params;
    if (!Number.isFinite(id)) return next(new AppError('Invalid person id', 400));
    if (!isValidVariant(variant)) return next(new AppError('Invalid variant', 400));

    // For the active person the working tables are the live source of truth
    // (what the editor currently shows), so render those directly — same as
    // POST /compile. Other persons render from their stored snapshot without
    // disturbing active-person state.
    let compileData, personName;
    try {
      if (getDb().getActivePersonId() === id) {
        compileData = getDb().getAllForCompile(variant);
        const p = getDb().getPerson(id);
        personName = p && p.name;
      } else {
        compileData = getDb().getCompileDataForPerson(id, variant);
        personName = compileData.name;
      }
    } catch (e) {
      if (e.message === 'Person not found') return next(new NotFoundError('Person not found'));
      if (e.message === 'Person has no data') return next(new AppError('Person has no data', 400));
      return next(e);
    }

    // Render into a unique temp dir so concurrent requests for the same
    // person+variant can't clobber each other's intermediate files. Removed
    // once the PDF has been sent (or on any failure).
    const personDir = path.join(projectRoot, 'build', 'persons', String(id));
    let buildDir, mainTexFile;
    try {
      fs.mkdirSync(personDir, { recursive: true });
      buildDir = fs.mkdtempSync(path.join(personDir, variant + '-'));
      const { generateAll } = require('../lib/generator');
      mainTexFile = generateAll(compileData, buildDir, TEMPLATES_DIR, ASSETS_DIR);
    } catch (e) {
      if (buildDir) cleanupDir(buildDir);
      return res.status(500).json({ success: false, log: 'File generation failed: ' + e.message });
    }

    execFile('fc-cache', ['-f', buildDir], { timeout: 5000 }, () => {
      execFile('xelatex', ['--no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', path.basename(mainTexFile)], {
        cwd: buildDir,
        timeout: 30000,
      }, (error, stdout, stderr) => {
        const pdfName = path.basename(mainTexFile, '.tex') + '.pdf';
        const pdfPath = path.join(buildDir, pdfName);
        if (error || !fs.existsSync(pdfPath)) {
          cleanupDir(buildDir);
          return res.status(500).json({
            success: false,
            log: stdout + (stderr ? '\n' + stderr : ''),
          });
        }

        const downloadName = `${slugifyName(personName || `person-${id}`)}-${variant}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
        res.sendFile(pdfPath, () => cleanupDir(buildDir));
      });
    });
  });

  return router;
};
