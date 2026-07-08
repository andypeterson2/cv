const express = require('express');
const path = require('path');
const fs = require('fs');
const { validate } = require('../lib/schema');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const { rateLimit } = require('express-rate-limit');
const { clientIp } = require('../lib/client-ip');
const { queuedCompile } = require('../lib/render/latex');

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

const { renderVariant } = require('../lib/render/host');
const { selectLayout } = require('../lib/render/select');

module.exports = function createVariantsRouter(getDb, projectRoot) {
  const router = express.Router();
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
    if (v.kind === 'coverletter') {
      body.letterSections = db.getLetterSections(id);
      body.header = db.getLetterHeader(id);
    }
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

  // Choose this variant's layout. `layout_id: null` (or "") reverts to the
  // global default. A non-null id must exist, be active, and support the kind.
  router.put('/:id/layout', wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    const v = requireVariant(id);
    const layoutId = req.body ? req.body.layout_id : undefined;
    if (layoutId == null || layoutId === '') {
      getDb().setVariantLayout(id, null);
      return res.json({ success: true, layout_id: null });
    }
    if (typeof layoutId !== 'string') throw new AppError('layout_id must be a string or null', 400);
    const layout = getDb().getLayout(layoutId);
    if (!layout) throw new NotFoundError('Layout not found');
    if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
    if (Array.isArray(layout.kinds) && !layout.kinds.includes(v.kind)) {
      throw new AppError(`Layout "${layoutId}" does not support ${v.kind}`, 409);
    }
    getDb().setVariantLayout(id, layoutId);
    res.json({ success: true, layout_id: layoutId });
  }));

  // ---- Rules / sections / overrides ----

  router.put('/:id/rules', validate('variantRules'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().setVariantRules(id, { include: req.body.include || [], exclude: req.body.exclude || [] });
    res.json({ success: true });
  }));

  // Author-time fuzzy expansion: grow the include set from the current seed tags
  // and write the concrete result back. Resolution stays exact (see lib/db).
  router.post('/:id/rules/expand', validate('expandRules'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    const result = getDb().expandVariantRules(id, { threshold: req.body.threshold, limit: req.body.limit });
    res.json({ success: true, ...result });
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

  // ---- Cover-letter header (per variant) ----

  router.patch('/:id/header', validate('letterHeader'), wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    getDb().setLetterHeader(id, req.body);
    res.json({ success: true });
  }));

  // ---- Resolution preview ----

  router.get('/:id/resolve', wrap((req, res) => {
    const id = intId(req.params.id, 'variant id');
    requireVariant(id);
    res.json(getDb().resolveVariant(id));
  }));

  // ---- Compile to PDF (resolve → generate → xelatex) ----
  //
  // The compile endpoints are the one real DoS lever (each spawns xelatex for up
  // to 30s). Two guards: a per-IP rate limit on inflow, and the shared
  // concurrency cap in lib/render/latex so a burst queues instead of forking N
  // LaTeX processes at once (also shared with the verification harness).
  const compileRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.CV_COMPILE_RATE_MAX) || 10,
    keyGenerator: clientIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, log: 'Too many compile requests — please wait a moment.' },
  });

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
      // Resolve the layout: variant.layout_id ?? global default ?? builtin.
      const { dir: layoutDir } = selectLayout(getDb(), variant);
      mainTexFile = renderVariant(compileData, buildDir, { layoutDir, assetsDir: ASSETS_DIR });
    } catch (e) {
      if (buildDir) cleanupDir(buildDir);
      return res.status(500).json({ success: false, log: 'File generation failed: ' + e.message });
    }

    // Queue the expensive xelatex run behind the shared concurrency limiter.
    queuedCompile(buildDir, mainTexFile)
      .then((result) => {
        if (!result.ok) {
          cleanupDir(buildDir);
          return res.status(500).json({ success: false, log: result.log });
        }
        if (inline) {
          const filename = `${slugifyName(variant.name)}-${variant.kind}.pdf`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          res.sendFile(result.pdfPath, () => cleanupDir(buildDir));
        } else {
          res.json({ success: true, log: result.log });
          cleanupDir(buildDir);
        }
      })
      .catch((e) => {
        cleanupDir(buildDir);
        res.status(500).json({ success: false, log: 'Compile failed: ' + e.message });
      });
  }

  router.get('/:id/pdf', compileRateLimit, (req, res) => compileVariant(intId(req.params.id, 'variant id'), res, { inline: true }));
  router.post('/:id/compile', compileRateLimit, (req, res) => compileVariant(intId(req.params.id, 'variant id'), res, { inline: false }));

  return router;
};
