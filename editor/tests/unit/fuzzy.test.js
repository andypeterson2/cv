/**
 * Unit tests for the approximate tag matcher (lib/fuzzy).
 * Pure functions — no DB, no I/O.
 */

const { trigrams, diceCoefficient, scoreTag, searchTags } = require('../../lib/fuzzy');

describe('trigrams', () => {
  test('boundary-padded 3-grams', () => {
    const g = trigrams('go');
    // "  go " → "  g", " go", "go "
    expect(g).toEqual(new Set(['  g', ' go', 'go ']));
  });

  test('returns a set (deduped)', () => {
    expect(trigrams('aaaa') instanceof Set).toBe(true);
  });
});

describe('diceCoefficient', () => {
  test('identical strings score 1', () => {
    expect(diceCoefficient('frontend', 'frontend')).toBe(1);
  });

  test('symmetric', () => {
    expect(diceCoefficient('frontend', 'frontends')).toBeCloseTo(
      diceCoefficient('frontends', 'frontend'),
      10,
    );
  });

  test('near strings score high, disjoint score low', () => {
    expect(diceCoefficient('frontend', 'frontends')).toBeGreaterThan(0.7);
    expect(diceCoefficient('frontend', 'kubernetes')).toBeLessThan(0.2);
  });
});

describe('scoreTag', () => {
  test('exact match', () => {
    expect(scoreTag('react', 'react')).toEqual({ score: 1, via: 'exact' });
  });

  test('prefix match scores by length ratio, in [0.6, 1)', () => {
    const s = scoreTag('front', 'frontend');
    expect(s.via).toBe('prefix');
    expect(s.score).toBeGreaterThanOrEqual(0.6);
    expect(s.score).toBeLessThan(1);
  });

  test('typo earns a trigram score', () => {
    const s = scoreTag('fronend', 'frontend');
    expect(s.via).toBe('trigram');
    expect(s.score).toBeGreaterThan(0.5);
  });

  test('substring containment is boosted', () => {
    const s = scoreTag('kubernetes', 'kubernetes-operator');
    expect(['substring', 'prefix']).toContain(s.via);
    expect(s.score).toBeGreaterThan(0.5);
  });

  test('short non-exact/non-prefix strings do not trigram-match', () => {
    expect(scoreTag('ml', 'machine-learning')).toBeNull();
    expect(scoreTag('go', 'rust')).toBeNull();
  });

  test('short exact and prefix still match', () => {
    expect(scoreTag('go', 'go').via).toBe('exact');
    expect(scoreTag('ml', 'mlops').via).toBe('prefix');
  });

  test('unrelated strings return null', () => {
    expect(scoreTag('frontend', 'accounting')).toBeNull();
  });
});

describe('searchTags', () => {
  const vocab = [
    { tag: 'frontend', count: 5 },
    { tag: 'front-end', count: 2 },
    { tag: 'backend', count: 3 },
    { tag: 'kubernetes', count: 1 },
  ];

  test('ranks best match first and respects minScore', () => {
    const out = searchTags('frontend', vocab, { minScore: 0.3 });
    expect(out[0].tag).toBe('frontend');
    expect(out[0].score).toBe(1);
    expect(out.find((r) => r.tag === 'kubernetes')).toBeUndefined();
  });

  test('limit caps results', () => {
    // 'frontend' matches several entries at minScore 0; limit must cap to 1.
    expect(searchTags('frontend', vocab, { limit: 1, minScore: 0 }).length).toBeGreaterThan(0);
    expect(searchTags('frontend', vocab, { limit: 1, minScore: 0 })).toHaveLength(1);
  });

  test('deterministic tie-break: score desc, then count desc, then tag asc', () => {
    const tied = [
      { tag: 'zebra', count: 1 },
      { tag: 'alpha', count: 1 },
      { tag: 'beta', count: 9 },
    ];
    // All score identically (exact) only if query equals — instead force equal scores via prefix of same ratio.
    const out = searchTags(
      'x',
      [
        { tag: 'xa', count: 1 },
        { tag: 'xb', count: 9 },
        { tag: 'xc', count: 1 },
      ],
      { minScore: 0 },
    );
    // equal prefix score (ratio 1/2 each) → count desc then tag asc
    expect(out.map((r) => r.tag)).toEqual(['xb', 'xa', 'xc']);
    expect(tied).toBeDefined();
  });

  test('same input → identical output (stable)', () => {
    const a = JSON.stringify(searchTags('frontend', vocab));
    const b = JSON.stringify(searchTags('frontend', vocab));
    expect(a).toBe(b);
  });
});
