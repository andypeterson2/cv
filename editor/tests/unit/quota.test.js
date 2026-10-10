const { assertLayoutBytes, assertBelow, isUnlimited } = require('../../lib/quota');

const MB = 1024 * 1024;
const stubDb = (usage) => ({
  ownerUserId: () => 1,
  systemUserId: () => 2,
  accountUsage: () => usage,
});

describe('quota checks', () => {
  beforeAll(() => {
    process.env.CV_ACCOUNT_QUOTA_MB = '10';
    process.env.CV_LAYOUTS_PER_ACCOUNT = '3';
  });
  afterAll(() => {
    delete process.env.CV_ACCOUNT_QUOTA_MB;
    delete process.env.CV_LAYOUTS_PER_ACCOUNT;
  });

  test('a layout must fit in what the account has left, counting what it replaces', () => {
    const db = stubDb({ contentBytes: 4 * MB, layoutBytes: 4 * MB, layouts: 1 });
    expect(() => assertLayoutBytes(db, 9, 3 * MB)).toThrow(/past its 10.0 MB limit/);
    expect(() => assertLayoutBytes(db, 9, 3 * MB, 2 * MB)).not.toThrow();
  });

  test('counts stop at the limit, and the owner and demo account are not limited', () => {
    const db = stubDb({ contentBytes: 0, layoutBytes: 0, layouts: 3 });
    expect(() => assertBelow(db, 9, 'layout')).toThrow(/already has 3/);
    expect(() => assertBelow(db, 1, 'layout')).not.toThrow();
    expect(isUnlimited(db, 2)).toBe(true);
    expect(isUnlimited(db, 9)).toBe(false);
  });
});
