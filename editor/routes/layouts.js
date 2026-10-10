const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { clientIp } = require('../lib/client-ip');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const {
  verifyLayout,
  gatherSamples,
  publicReport,
  slowestCompile,
  summarizeReport,
} = require('../lib/render/verify');
const { readBundle, zipBundle, forgetZip, dirBytes } = require('../lib/render/bundle');
const { assertBelow, assertLayoutBytes } = require('../lib/quota');
const { downloadZip } = require('../lib/fetch-zip');
const { pinCheck } = require('../lib/render/pin-check');
const { bundleChecksum } = require('../lib/render/seed');
const { uploadedLayoutDir, layoutDirForRow, DEFAULT_LAYOUT_ID } = require('../lib/render/layouts');

// The row id an upload is stored under. Two accounts may install the same manifest
// id, so the stored id carries the installer; the manifest keeps its own id as
// provenance. Treat the prefix as opaque: what a caller may reach is decided by the
// row's user_id, never by reading a number back out of this string.
function storedLayoutId(userId, manifestId) {
  return `u${userId}-${manifestId}`;
}

// What a caller sees of a layout row: never another account's user id, and the
// owner's review note and the disk size only on the caller's own rows.
function present(layout, userId) {
  if (!layout) return layout;
  const { userId: owner, reviewNote, bytes, ...rest } = layout;
  const own = owner != null && owner === userId;
  return own ? { ...rest, reviewNote, bytes, own } : { ...rest, own };
}

// The fixture compile limit a version must meet before the owner can approve it.
const MAX_COMPILE_MS = () => Number(process.env.CV_LAYOUT_MAX_COMPILE_MS) || 10000;

function upsertFromManifest(db, manifest, { id, status, source, checksum, report, userId, bytes }) {
  return db.upsertLayout({
    id,
    name: manifest.name || manifest.id,
    version: manifest.version,
    engine: manifest.engine,
    kinds: manifest.kinds,
    status,
    source,
    manifest,
    checksum,
    report,
    verified_at: new Date().toISOString(),
    userId,
    bytes,
  });
}

/**
 * Layouts API: upload (gated by the verification harness), on-demand re-verify,
 * and delete, plus list / get / default selection.
 *
 * Every route is scoped to `req.userId`. An account sees the builtins plus its own
 * uploads, and an id belonging to someone else reads as missing.
 */
module.exports = function createLayoutsRouter(getDb, projectRoot) {
  const router = express.Router();
  const ASSETS_DIR = path.join(projectRoot, 'assets');

  const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  const uploadRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.CV_UPLOAD_RATE_MAX) || 5,
    keyGenerator: clientIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many layout uploads — please wait.' } },
  });

  // An account with no default of its own reports the builtin, which is what the
  // selector would pick for it anyway.
  const defaultFor = (userId) => getDb().getDefaultLayoutId(userId) ?? DEFAULT_LAYOUT_ID;
  const isOwner = (req) => req.userId != null && req.userId === getDb().ownerUserId();
  const requireOwner = (req) => {
    if (!isOwner(req)) throw new AppError('Only the site owner can review layouts', 403);
  };
  // A layout the caller may newly pin, or a 404/409 explaining why not.
  const pinnable = (id, userId, kind = null) => {
    const layout = getDb().getLayout(id, userId);
    if (!layout || !getDb().canPinLayout(layout, userId))
      throw new NotFoundError('Layout not found');
    if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
    if (kind && Array.isArray(layout.kinds) && !layout.kinds.includes(kind))
      throw new AppError(`Layout does not support ${kind}`, 409);
    return layout;
  };
  // Keep the caller's full report to themselves; the row keeps the fixture part.
  const recordReport = (id, userId, report) => {
    if (userId != null) getDb().setLayoutReport(id, userId, report);
  };

  router.get(
    '/',
    wrap((req, res) => {
      res.json({
        layouts: getDb()
          .listLayouts(req.userId)
          .map((l) => present(l, req.userId)),
        default: defaultFor(req.userId),
        canReview: isOwner(req),
      });
    }),
  );

  // The owner's review queue. Registered before '/:id' so it is not read as an id.
  router.get(
    '/review',
    wrap((req, res) => {
      requireOwner(req);
      const pending = getDb()
        .listPendingLayouts()
        .map((l) => {
          const review = (l.report?.checks || []).find((c) => c.name === 'security:review');
          return { ...present(l, req.userId), report: l.report, warnings: review?.warnings || [] };
        });
      res.json({ pending, maxCompileMs: MAX_COMPILE_MS() });
    }),
  );

  router.get(
    '/default',
    wrap((req, res) => {
      res.json({ layout_id: defaultFor(req.userId) });
    }),
  );

  router.put(
    '/default',
    wrap(async (req, res) => {
      const id = req.body && req.body.layout_id;
      if (typeof id !== 'string' || !id) throw new AppError('layout_id is required', 400);
      const layout = pinnable(id, req.userId);
      const warnings = await pinCheck(getDb(), layout, req.userId, { assetsDir: ASSETS_DIR });
      getDb().setDefaultLayoutId(id, req.userId);
      res.json({ success: true, warnings });
    }),
  );

  /**
   * Verify the zip at `zipPath` as the caller's layout and, unless `dryRun`, install
   * it. Returns the HTTP status and body; nothing is installed unless verification
   * passes. `missing` lists what to fix, in plain sentences.
   */
  async function checkOrInstall(zipPath, userId, { dryRun }) {
    const { work, root, manifest } = await readBundle(zipPath, getDb());
    try {
      const report = await verifyLayout(root, {
        assetsDir: ASSETS_DIR,
        samples: gatherSamples(getDb(), { userId }),
        compileKey: userId,
      });
      const missing = summarizeReport(report, manifest);
      if (dryRun) return { status: 200, body: { ok: report.ok, missing, report } };
      if (!report.ok) {
        return {
          status: 422,
          body: {
            error: {
              code: 'verification_failed',
              message: 'Layout failed verification',
              details: report,
            },
            missing,
          },
        };
      }
      const storedId = storedLayoutId(userId, manifest.id);
      const existing = getDb().getLayout(storedId, userId);
      if (!existing) assertBelow(getDb(), userId, 'layout');
      const bytes = dirBytes(root);
      assertLayoutBytes(getDb(), userId, bytes, existing ? existing.bytes : 0);
      const replacedChecksum = existing ? existing.checksum : null;
      const dest = uploadedLayoutDir(storedId);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(root, dest, { recursive: true });
      const row = upsertFromManifest(getDb(), manifest, {
        id: storedId,
        status: 'active',
        source: 'upload',
        checksum: bundleChecksum(dest),
        report: publicReport(report),
        userId,
        bytes,
      });
      recordReport(storedId, userId, report);
      if (replacedChecksum && replacedChecksum !== row.checksum)
        forgetZip(replacedChecksum, getDb().layoutChecksumInUse(replacedChecksum));
      return {
        status: 201,
        body: { success: true, layout: present(row, userId), report, missing },
      };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  const fromUpload = (dryRun) =>
    wrap(async (req, res) => {
      if (!req.file) throw new AppError('Expected a .zip bundle in form field "bundle"', 400);
      try {
        const { status, body } = await checkOrInstall(req.file.path, req.userId, { dryRun });
        res.status(status).json(body);
      } finally {
        fs.rmSync(req.file.path, { force: true });
      }
    });

  // Upload a .zip bundle → extract (zip-slip-safe) → verify → install or reject.
  router.post('/', uploadRateLimit, upload.single('bundle'), fromUpload(false));

  // The same verification without installing: what the bundle is missing.
  router.post('/check', uploadRateLimit, upload.single('bundle'), fromUpload(true));

  // Check or install a zip the server fetches from an https URL (for the MCP
  // connector, which cannot send a file).
  router.post(
    '/from-url',
    uploadRateLimit,
    wrap(async (req, res) => {
      const url = req.body && req.body.url;
      if (typeof url !== 'string' || !url) throw new AppError('url is required', 400);
      const dryRun = Boolean(req.body.dryRun);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-url-'));
      try {
        const file = await downloadZip(url, path.join(dir, 'bundle.zip'));
        const { status, body } = await checkOrInstall(file, req.userId, { dryRun });
        res.status(status).json(body);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
  );

  // Download a layout as a zip: a builtin, the caller's own, a public version, or an
  // unlisted one the caller has pinned.
  router.get(
    '/:id/bundle',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      const allowed =
        layout &&
        (getDb().canPinLayout(layout, req.userId) ||
          (layout.state === 'unlisted' && getDb().hasLayoutPin(layout.id, req.userId)));
      if (!allowed) throw new NotFoundError('Layout not found');
      const file = await zipBundle(layoutDirForRow(layout), layout.checksum);
      const name = `${layout.family}${layout.versionNo ? `-v${layout.versionNo}` : ''}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.sendFile(file, { dotfiles: 'allow' });
    }),
  );

  router.get(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      const mine = getDb().getLayoutReport(layout.id, req.userId);
      res.json({ ...present(layout, req.userId), myReport: mine ? mine.report : null });
    }),
  );

  // Re-run the contract gate on an installed layout (e.g. after data changes).
  // A previously-active upload that now fails is marked invalid (→ falls back). Only
  // the uploader's own row changes status: a builtin, or anyone else's layout, is
  // shared, so one account's result must not switch it off for everybody.
  router.post(
    '/:id/verify',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      const report = await verifyLayout(layoutDirForRow(layout), {
        assetsDir: ASSETS_DIR,
        samples: gatherSamples(getDb(), { userId: req.userId }),
        compileKey: req.userId,
      });
      recordReport(layout.id, req.userId, report);
      if (layout.source === 'builtin' || layout.userId !== req.userId) {
        return res.json({ ok: report.ok, report });
      }
      // Re-upsert under the row's own id and owner. The manifest carries the bare
      // id it was authored with, so upserting by that would insert a second row.
      upsertFromManifest(
        getDb(),
        layout.manifest || {
          id: layout.id,
          name: layout.name,
          version: layout.version,
          engine: layout.engine,
          kinds: layout.kinds,
        },
        {
          id: layout.id,
          status: report.ok ? 'active' : 'invalid',
          source: layout.source,
          checksum: layout.checksum,
          report: publicReport(report),
          userId: layout.userId,
        },
      );
      res.json({ ok: report.ok, report });
    }),
  );

  // Publish one of the caller's uploads: snapshot it as the next version of its
  // family, verify the snapshot on fixtures only, and queue it for the owner.
  router.post(
    '/:id/publish',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout || layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      if (layout.versionNo != null) throw new AppError('Publish the upload, not a version', 409);
      if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
      assertBelow(getDb(), req.userId, 'layout');
      assertBelow(getDb(), req.userId, 'pending');
      assertLayoutBytes(
        getDb(),
        req.userId,
        layout.bytes || dirBytes(uploadedLayoutDir(layout.id)),
      );
      const n = getDb().nextLayoutVersion(layout.family);
      const id = `${layout.id}@${n}`;
      const dest = uploadedLayoutDir(id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(uploadedLayoutDir(layout.id), dest, { recursive: true });
      const report = await verifyLayout(dest, {
        assetsDir: ASSETS_DIR,
        compileKey: req.userId,
      });
      if (!report.ok) {
        fs.rmSync(dest, { recursive: true, force: true });
        return res.status(422).json({
          error: {
            code: 'verification_failed',
            message: 'Layout failed verification',
            details: report,
          },
        });
      }
      const manifest = layout.manifest || { id: layout.family, kinds: layout.kinds };
      getDb().upsertLayout({
        id,
        name: manifest.name || layout.name,
        version: manifest.version,
        engine: manifest.engine,
        kinds: manifest.kinds,
        status: 'active',
        source: 'upload',
        manifest,
        checksum: bundleChecksum(dest),
        report,
        verified_at: new Date().toISOString(),
        userId: req.userId,
        family: layout.family,
        versionNo: n,
        state: 'pending',
        compileMs: slowestCompile(report),
        bytes: dirBytes(dest),
      });
      res
        .status(201)
        .json({ success: true, layout: present(getDb().getLayout(id, req.userId), req.userId) });
    }),
  );

  // Withdraw a version: it leaves the listings, and anyone already using it keeps it.
  router.post(
    '/:id/unpublish',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout || layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      if (!['public', 'pending'].includes(layout.state))
        throw new AppError('Only a public or pending version can be unpublished', 409);
      getDb().setLayoutState(layout.id, 'unlisted');
      res.json({ success: true });
    }),
  );

  // The owner's decision on a pending version. Approval re-checks that the files on
  // disk are the ones verified, that every fixture PDF passed the safety scan (a
  // skipped scan does not count), and that the fixtures compiled fast enough.
  router.post(
    '/:id/review',
    wrap((req, res) => {
      requireOwner(req);
      const decision = req.body && req.body.decision;
      const note = (req.body && typeof req.body.note === 'string' && req.body.note) || null;
      if (!['approve', 'reject'].includes(decision))
        throw new AppError('decision must be approve or reject', 400);
      const layout = getDb().getLayoutUnscoped(req.params.id);
      if (!layout || layout.state !== 'pending')
        throw new NotFoundError('No pending layout with that id');
      if (decision === 'reject') {
        getDb().setLayoutState(layout.id, 'rejected', { note });
        return res.json({ success: true, state: 'rejected' });
      }
      const problems = [];
      const dir = uploadedLayoutDir(layout.id);
      if (!fs.existsSync(dir) || bundleChecksum(dir) !== layout.checksum)
        problems.push('the files changed since verification');
      const pdf = (layout.report?.checks || []).filter((c) => c.name.startsWith('pdf:'));
      if (pdf.length === 0 || pdf.some((c) => !c.ok || c.skipped))
        problems.push('the PDF safety scan did not pass on every fixture');
      if (layout.compileMs == null || layout.compileMs > MAX_COMPILE_MS())
        problems.push(`a fixture took longer than ${MAX_COMPILE_MS()} ms to compile`);
      if (problems.length) throw new AppError(`Cannot approve: ${problems.join('; ')}`, 409);
      getDb().setLayoutState(layout.id, 'public', { note, publishedAt: new Date().toISOString() });
      res.json({ success: true, state: 'public' });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.source === 'builtin') throw new AppError('Cannot delete a builtin layout', 409);
      if (layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      // A public version is withdrawn first; once unlisted and used by nobody, it can go.
      const shared = layout.versionNo != null && ['public', 'unlisted'].includes(layout.state);
      if (shared && (layout.state === 'public' || getDb().layoutInUse(layout.id))) {
        getDb().setLayoutState(layout.id, 'unlisted');
        return res.json({ success: true, unlisted: true });
      }
      fs.rmSync(uploadedLayoutDir(layout.id), { recursive: true, force: true });
      getDb().deleteLayout(layout.id, req.userId); // also reverts referencing variants to NULL
      forgetZip(layout.checksum, getDb().layoutChecksumInUse(layout.checksum));
      if (getDb().getDefaultLayoutId(req.userId) === layout.id) {
        getDb().setDefaultLayoutId(DEFAULT_LAYOUT_ID, req.userId);
      }
      res.json({ success: true });
    }),
  );

  return router;
};
