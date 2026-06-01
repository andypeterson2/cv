const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');

function intId(value, label = 'id') {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) throw new AppError(`Invalid ${label}`, 400);
  return n;
}

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

module.exports = function createVariantsRouter(getDb, projectRoot) {
  const router = express.Router();
  const TEMPLATES_DIR = path.join(projectRoot, 'templates');
  const ASSETS_DIR = path.join(projectRoot, 'assets');

  const requireVariant = (id) => {
    const v = getDb().getVariant(id);
    if (!v) throw new NotFoundError('Variant not found');
    return v;
  };

  // ---- Variant CRUD ----

  router.get('/:id', wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    const v = requireVariant(id);
    const db = getDb();
    const body = {
      ...v,
      rules: db.getVariantRules(id),
      sections: db.getVariantSections(id),
      entryOverrides: Object.fromEntries(db.getEntryOverrides(id)),
      itemOverrides: Object.fromEntries(db.getItemOverrides(id)),
    };
    if (v.kind === 'coverletter') body.letterSections = db.getLetterSections(id);
    res.json(body);
  }));

  router.put('/:id', validate('updateVariant'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().updateVariant(id, { name: req.body.name });
    res.json({ success: true });
  }));

  router.delete('/:id', wrap((req, res) => {
    getDb().deleteVariant(intId(req.params.id, 'variant id'));
    res.json({ success: true });
  }));

  // ---- Rules / sections / overrides ----

  router.put('/:id/rules', validate('variantRules'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().setVariantRules(id, { include: req.body.include || [], exclude: req.body.exclude || [] });
    res.json({ success: true });
  }));

  router.put('/:id/sections', validate('variantSections'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().setVariantSections(id, req.body.sections);
    res.json({ success: true });
  }));

  router.put('/:id/overrides', validate('variantOverride'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    const { targetType, targetId, included, textOverride, sortOverride } = req.body;
    const patch = { included, textOverride, sortOverride };
    if (targetType === 'entry') getDb().setEntryOverride(id, targetId, patch);
    else getDb().setItemOverride(id, targetId, patch);
    res.json({ success: true });
  }));

  // ---- Cover-letter paragraphs ----

  router.get('/:id/letter-sections', wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    res.json(getDb().getLetterSections(id));
  }));

  router.post('/:id/letter-sections', validate('createLetterSection'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    res.status(201).json({ id: Number(getDb().createLetterSection(id, req.body.title, req.body.body)) });
  }));

  router.put('/:id/letter-sections/:lid', validate('updateLetterSection'), wrap((req, res) => {
    intId(req.params.id, 'variant id');
    getDb().updateLetterSection(intId(req.params.lid, 'letter section id'), req.body);
    res.json({ success: true });
  }));

  router.delete('/:id/letter-sections/:lid', wrap((req, res) => {
    getDb().deleteLetterSection(intId(req.params.lid, 'letter section id'));
    res.json({ success: true });
  }));

  router.patch('/:id/letter-sections/order', validate('reorder'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().reorderLetterSections(id, req.body.ids);
    res.json({ success: true });
  }));

  // ---- Resolution preview ----

  router.get('/:id/resolve', wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    res.json(getDb().resolveVariant(id));
  }));

  // ---- Compile to PDF (resolve → generate → xelatex) ----

  function compileVariant(id, res, { inline }) {
    let compileData, variant;
    try {
      variant = getDb().getVariant(id);
      if (!variant) return res.status(404).json({ success: false, log: 'Variant not found' });
      compileData = getDb().resolveVariant(id);
    } catch (e) {
      return res.status(500).json({ success: false, log: 'Resolution failed: ' + e.message });
    }

    const personDir = path.join(projectRoot, 'build', 'variants', String(id));
    let buildDir, mainTexFile;
    try {
      fs.mkdirSync(personDir, { recursive: true });
      buildDir = fs.mkdtempSync(path.join(personDir, variant.kind + '-'));
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
        const pdfPath = path.join(buildDir, path.basename(mainTexFile, '.tex') + '.pdf');
        if (error || !fs.existsSync(pdfPath)) {
          cleanupDir(buildDir);
          return res.status(500).json({ success: false, log: stdout + (stderr ? '\n' + stderr : '') });
        }
        if (inline) {
          const filename = `${slugifyName(variant.name)}-${variant.kind}.pdf`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          res.sendFile(pdfPath, () => cleanupDir(buildDir));
        } else {
          res.json({ success: true, log: stdout });
          cleanupDir(buildDir);
        }
      });
    });
  }

  router.get('/:id/pdf', (req, res) => compileVariant(intId(req.params.id, 'variant id'), res, { inline: true }));
  router.post('/:id/compile', (req, res) => compileVariant(intId(req.params.id, 'variant id'), res, { inline: false }));

  return router;
};
