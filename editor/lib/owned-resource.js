/**
 * The per-user gate on the id-addressed routes (/sections/:id, /entries/:id,
 * /items/:id, /variants/:id). A write needs the caller to own the profile the
 * resource hangs off; a read also passes for a public profile, which is what keeps
 * the logged-out demo readable. Anything else raises NotFoundError, so a
 * cross-user id looks exactly like a missing one and leaks nothing.
 */
const { NotFoundError } = require('./errors');
const { publicProfileIdSet } = require('./public-profiles');

/**
 * @param {Function} getDb - the CvDatabase accessor the router holds
 * @param {'variant'|'section'|'entry'|'item'} kind
 * @param {string} label - the noun in the 404 message, e.g. 'Section'
 * @returns {(id: number, userId: number|null, opts?: {write?: boolean}) => number} the owning profile id
 */
function ownedResourceGuard(getDb, kind, label) {
  const publicIds = publicProfileIdSet(process.env.CV_PUBLIC_PROFILE_IDS || '1');
  return (id, userId, { write = true } = {}) => {
    const db = getDb();
    const profileId = db.ownerProfileId(kind, id);
    if (profileId == null) throw new NotFoundError(`${label} not found`);
    if (db.getProfileForUser(profileId, userId)) return profileId;
    if (!write && publicIds.has(String(profileId))) return profileId;
    throw new NotFoundError(`${label} not found`);
  };
}

module.exports = { ownedResourceGuard };
