/**
 * Per-account storage limits, so one account cannot fill the database or the
 * layout store. Every limit can be raised with an environment variable; the site
 * owner and the demo account are not limited.
 *
 *   CV_ACCOUNT_QUOTA_MB       total stored text plus layout files per account (50)
 *   CV_PROFILES_PER_ACCOUNT   profiles per account (20)
 *   CV_VERSIONS_PER_PROFILE   saved versions per profile (100)
 *   CV_LAYOUTS_PER_ACCOUNT    uploaded layouts and versions per account (20)
 *   CV_PENDING_LAYOUTS        versions waiting for review per account (3)
 *   CV_BUNDLE_MAX_MB          unpacked size of one layout zip (50)
 *   CV_BUNDLE_MAX_FILES       files in one layout zip (2000)
 *
 * Writes are checked against a per-account usage figure that is recomputed from
 * the database at most every REFRESH_MS and grows by each allowed request's size
 * in between, so a burst of writes cannot slip past between recomputes.
 */
const { AppError } = require('./errors');

const num = (name, fallback) => Number(process.env[name]) || fallback;
const limits = () => ({
  bytes: num('CV_ACCOUNT_QUOTA_MB', 50) * 1024 * 1024,
  profiles: num('CV_PROFILES_PER_ACCOUNT', 20),
  versions: num('CV_VERSIONS_PER_PROFILE', 100),
  layouts: num('CV_LAYOUTS_PER_ACCOUNT', 20),
  pending: num('CV_PENDING_LAYOUTS', 3),
  bundleBytes: num('CV_BUNDLE_MAX_MB', 50) * 1024 * 1024,
  bundleFiles: num('CV_BUNDLE_MAX_FILES', 2000),
});

const REFRESH_MS = 30_000;

class QuotaError extends AppError {
  constructor(message, details) {
    super(message, 413);
    this.code = 'quota_exceeded';
    this.details = details;
  }
}

function isUnlimited(db, userId) {
  return userId == null || userId === db.ownerUserId() || userId === db.systemUserId();
}

const MB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** What an account stores, as the usage endpoint reports it. */
function usageReport(db, userId) {
  const l = limits();
  const u = db.accountUsage(userId);
  return {
    unlimited: isUnlimited(db, userId),
    bytes: {
      used: u.contentBytes + u.layoutBytes,
      content: u.contentBytes,
      layouts: u.layoutBytes,
      limit: l.bytes,
    },
    profiles: { used: u.profiles, limit: l.profiles },
    layouts: { used: u.layouts, limit: l.layouts },
    pendingLayouts: { used: u.pendingLayouts, limit: l.pending },
    versionsPerProfile: { limit: l.versions },
  };
}

/**
 * Express middleware refusing a write (POST/PUT/PATCH) from an account already at
 * its byte quota. Deletes always pass, so an account can free space.
 */
function storageGuard(getDb) {
  const cache = new Map(); // userId -> { at, total }
  return function (req, res, next) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const db = getDb();
    const userId = req.userId;
    if (isUnlimited(db, userId)) return next();
    const now = Date.now();
    let entry = cache.get(userId);
    if (!entry || now - entry.at > REFRESH_MS) {
      const u = db.accountUsage(userId);
      entry = { at: now, total: u.contentBytes + u.layoutBytes };
      cache.set(userId, entry);
    }
    const incoming = Number(req.headers['content-length']) || 0;
    const limit = limits().bytes;
    if (entry.total + incoming > limit) {
      return res.status(413).json({
        error: {
          code: 'quota_exceeded',
          message: `This account stores ${MB(entry.total)} of its ${MB(limit)} limit. Delete old versions, profiles or layouts to make room.`,
        },
      });
    }
    entry.total += incoming;
    next();
  };
}

/** Refuse creating one more of something an account has reached the limit on. */
function assertBelow(db, userId, what) {
  if (isUnlimited(db, userId)) return;
  const l = limits();
  const u = db.accountUsage(userId);
  const checks = {
    profile: [u.profiles, l.profiles, 'profiles'],
    layout: [u.layouts, l.layouts, 'uploaded layouts and versions'],
    pending: [u.pendingLayouts, l.pending, 'layout versions waiting for review'],
  };
  const [used, limit, noun] = checks[what];
  if (used >= limit)
    throw new QuotaError(`This account already has ${limit} ${noun}, the most allowed.`);
}

function assertVersionRoom(db, userId, profileId) {
  if (isUnlimited(db, userId)) return;
  const limit = limits().versions;
  if (db.countVersions(profileId) >= limit)
    throw new QuotaError(
      `This profile already has ${limit} saved versions. Delete some to save more.`,
    );
}

/** Refuse a layout whose files would take the account past its byte quota. */
function assertLayoutBytes(db, userId, addBytes, replacingBytes = 0) {
  if (isUnlimited(db, userId)) return;
  const u = db.accountUsage(userId);
  const after = u.contentBytes + u.layoutBytes - replacingBytes + addBytes;
  const limit = limits().bytes;
  if (after > limit)
    throw new QuotaError(
      `This layout needs ${MB(addBytes)}, which would take the account past its ${MB(limit)} limit.`,
    );
}

module.exports = {
  limits,
  isUnlimited,
  usageReport,
  storageGuard,
  assertBelow,
  assertVersionRoom,
  assertLayoutBytes,
  QuotaError,
};
