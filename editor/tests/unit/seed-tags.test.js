/**
 * The starter tag vocabulary: every tag is stored in canonical form, unique,
 * described, and credited to the classification it came from. ESCO supplies the
 * skills and competences; O*NET supplies the named technologies ESCO is thin on.
 */
const { SEED_TAGS, SEED_ATTRIBUTION, seedTag } = require('../../lib/seed-tags');
const { normTag } = require('../../lib/db/helpers');

describe('seed tags', () => {
  test('every tag is already canonical and unique', () => {
    for (const { tag } of SEED_TAGS) expect(normTag(tag)).toBe(tag);
    expect(new Set(SEED_TAGS.map((t) => t.tag)).size).toBe(SEED_TAGS.length);
  });

  test('every tag has a description and a known category', () => {
    const categories = new Set([
      'core',
      'esco-ict',
      'esco-transversal',
      'esco-research',
      'onet-technology',
    ]);
    for (const t of SEED_TAGS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(categories.has(t.category)).toBe(true);
      // An ESCO tag carries the concept it was shortened from. O*NET names are
      // not concept URIs, so only the ESCO ones are checked for one.
      if (t.category.startsWith('esco-')) {
        expect(t.uri).toMatch(/^http:\/\/data\.europa\.eu\/esco\//);
      }
    }
  });

  test('a tag never has a slash, which would break the tag routes', () => {
    for (const { tag } of SEED_TAGS) expect(tag).not.toMatch(/\//);
  });

  test('both classifications are credited', () => {
    expect(SEED_ATTRIBUTION).toMatch(/ESCO/);
    expect(SEED_ATTRIBUTION).toMatch(/European Union/);
    expect(SEED_ATTRIBUTION).toMatch(/O\*NET/);
    expect(SEED_ATTRIBUTION).toMatch(/CC BY 4\.0/);
  });

  test('the technologies ESCO lacks are now there, and not duplicated', () => {
    for (const tag of ['docker', 'kubernetes', 'react', 'node.js', 'terraform', 'graphql']) {
      expect(seedTag(tag), tag).toBeTruthy();
      expect(seedTag(tag).category).toBe('onet-technology');
    }
    // Already in ESCO, so O*NET must not have added a second one.
    for (const tag of ['python', 'java', 'typescript', 'postgresql']) {
      expect(seedTag(tag).category).toMatch(/^esco-/);
    }
  });

  test('ESCO labels are shortened to tags', () => {
    expect(seedTag('java').description).toMatch(/^Java \(computer programming\)/);
    expect(seedTag('leadership').category).toBe('core');
  });
});
