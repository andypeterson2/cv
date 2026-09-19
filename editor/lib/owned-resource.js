/**
 * The per-user gate on the id-addressed routes (/sections/:id, /entries/:id,
 * /items/:id, /variants/:id). A write needs the caller to own the person the
 * resource hangs off; a read also passes for a public person, which is what keeps
 * the logged-out demo readable. Anything else raises NotFoundError, so a
 * cross-user id looks exactly like a missing one and leaks nothing.
 */
const { NotFoundError } = require('./errors');
const { publicPersonIdSet } = require('./public-persons');

/**
 * @param {Function} getDb - the CvDatabase accessor the router holds
 * @param {'variant'|'section'|'entry'|'item'} kind
 * @param {string} label - the noun in the 404 message, e.g. 'Section'
 * @returns {(id: number, userId: number|null, opts?: {write?: boolean}) => number} the owning person id
 */
function ownedResourceGuard(getDb, kind, label) {
  const publicIds = publicPersonIdSet(process.env.CV_PUBLIC_PERSON_IDS || '1');
  return (id, userId, { write = true } = {}) => {
    const db = getDb();
    const personId = db.ownerPersonId(kind, id);
    if (personId == null) throw new NotFoundError(`${label} not found`);
    if (db.getPersonForUser(personId, userId)) return personId;
    if (!write && publicIds.has(String(personId))) return personId;
    throw new NotFoundError(`${label} not found`);
  };
}

module.exports = { ownedResourceGuard };
