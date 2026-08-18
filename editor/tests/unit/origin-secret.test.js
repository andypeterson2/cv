const { parseOriginSecrets, matchesOriginSecret } = require('../../lib/origin-secret');

describe('origin-secret set (zero-downtime rotation, tech-debt #7)', () => {
  test('parses a single value, a comma list, stray whitespace/empties, and nullish', () => {
    expect(parseOriginSecrets('abc')).toEqual(['abc']);
    expect(parseOriginSecrets('old,new')).toEqual(['old', 'new']);
    expect(parseOriginSecrets(' a , , b , ')).toEqual(['a', 'b']);
    expect(parseOriginSecrets('')).toEqual([]);
    expect(parseOriginSecrets(undefined)).toEqual([]);
    expect(parseOriginSecrets(null)).toEqual([]);
  });

  test('matches any accepted secret; rejects unknown, empty, and the no-secret case', () => {
    const set = parseOriginSecrets('old,new');
    expect(matchesOriginSecret('old', set)).toBe(true); // a sender still on the old value
    expect(matchesOriginSecret('new', set)).toBe(true); // a sender flipped to the new value
    expect(matchesOriginSecret('gone', set)).toBe(false);
    expect(matchesOriginSecret('', set)).toBe(false);
    expect(matchesOriginSecret(undefined, set)).toBe(false);
    expect(matchesOriginSecret('old', [])).toBe(false); // nothing accepted → never a match
  });
});
