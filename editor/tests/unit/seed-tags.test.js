/**
 * The starter tag vocabulary: every tag is stored in canonical form, unique,
 * described, and credited to ESCO where it comes from ESCO.
 */
const { SEED_TAGS, SEED_ATTRIBUTION, seedTag } = require('../../lib/seed-tags');
const { normTag } = require('../../lib/db/helpers');

describe('seed tags', () => {
  test('every tag is already canonical and unique', () => {
    for (const { tag } of SEED_TAGS) expect(normTag(tag)).toBe(tag);
    expect(new Set(SEED_TAGS.map((t) => t.tag)).size).toBe(SEED_TAGS.length);
  });

  test('every tag has a description and a known category', () => {
    const categories = new Set(['core', 'esco-ict', 'esco-transversal', 'esco-research']);
    for (const t of SEED_TAGS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(categories.has(t.category)).toBe(true);
      if (t.category !== 'core') expect(t.uri).toMatch(/^http:\/\/data\.europa\.eu\/esco\//);
    }
  });

  test('ESCO is credited', () => {
    expect(SEED_ATTRIBUTION).toMatch(/ESCO/);
    expect(SEED_ATTRIBUTION).toMatch(/European Union/);
  });

  test('ESCO labels are shortened to tags', () => {
    expect(seedTag('java').description).toMatch(/^Java \(computer programming\)/);
    expect(seedTag('leadership').category).toBe('core');
  });
});
