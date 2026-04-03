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

  return router;
};
