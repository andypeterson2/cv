/**
 * The ownership guard behind the id-addressed routes. Its whole job is the
 * read/write asymmetry: a public profile stays readable for everyone, while any
 * write needs the caller to own the profile. A refusal must look like a 404 so an id
 * never reveals whether it exists.
 */
const { ownedResourceGuard } = require('../../lib/owned-resource');
const { NotFoundError } = require('../../lib/errors');

const OWNER = 7;
const PUBLIC_PROFILE = 1;
const PRIVATE_PROFILE = 2;

/** A db stub: section 10 belongs to the public profile, 20 to a private one. */
function fakeDb() {
  return {
    ownerProfileId: (kind, id) => {
      if (kind !== 'section') return null;
      if (id === 10) return PUBLIC_PROFILE;
      if (id === 20) return PRIVATE_PROFILE;
      return null;
    },
    getProfileForUser: (profileId, userId) =>
      userId === OWNER && profileId === PRIVATE_PROFILE ? { id: profileId } : null,
  };
}

let guard;
beforeEach(() => {
  process.env.CV_PUBLIC_PROFILE_IDS = String(PUBLIC_PROFILE);
  const db = fakeDb();
  guard = ownedResourceGuard(() => db, 'section', 'Section');
});

afterEach(() => {
  delete process.env.CV_PUBLIC_PROFILE_IDS;
});

describe('ownedResourceGuard', () => {
  test('the owner may read and write their own resource', () => {
    expect(guard(20, OWNER, { write: false })).toBe(PRIVATE_PROFILE);
    expect(guard(20, OWNER)).toBe(PRIVATE_PROFILE);
  });

  test('a stranger gets NotFound on both a read and a write', () => {
    expect(() => guard(20, 99, { write: false })).toThrow(NotFoundError);
    expect(() => guard(20, 99)).toThrow(NotFoundError);
  });

  test('a public profile is readable by anyone', () => {
    expect(guard(10, 99, { write: false })).toBe(PUBLIC_PROFILE);
  });

  test('a public profile is still not writable by a non-owner', () => {
    expect(() => guard(10, 99)).toThrow(NotFoundError);
  });

  test('writes are the default, so a missing option is not a read', () => {
    expect(() => guard(10, 99)).toThrow(NotFoundError);
  });

  test('an unknown id is NotFound, with the label in the message', () => {
    expect(() => guard(999, OWNER, { write: false })).toThrow('Section not found');
  });
});
