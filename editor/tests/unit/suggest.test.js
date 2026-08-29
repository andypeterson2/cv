/**
 * Unit tests for the tag suggestion scorer (lib/suggest).
 * Pure functions — no DB, no I/O. suggestTags is async.
 */

const { suggestTags, tokenize, CATALOG_BOOST } = require('../../lib/suggest');

describe('tokenize', () => {
  test('drops stopwords and <2-char tokens', () => {
    const t = tokenize('Built a React UI in the app');
    expect(t).toContain('react');
    expect(t).toContain('app');
    expect(t).not.toContain('a');
    expect(t).not.toContain('in');
    expect(t).not.toContain('the');
  });

  test('forms adjacent bigrams joined by hyphen', () => {
    expect(tokenize('machine learning models')).toContain('machine-learning');
  });

  test('does not bridge a bigram across a stopword', () => {
    // "react in production" → no "react-production" (stopword "in" between)
    expect(tokenize('react in production')).not.toContain('react-production');
  });
});

describe('suggestTags (lexical)', () => {
  const vocab = [
    { tag: 'frontend', count: 2, inCatalog: false },
    { tag: 'react', count: 1, inCatalog: false },
    { tag: 'python', count: 1, inCatalog: false },
    { tag: 'kubernetes', count: 1, inCatalog: false },
  ];

  test('ranks content-matching tags first, drops unrelated', async () => {
    const out = await suggestTags('Built the React frontend component library', vocab, {
      minScore: 0.35,
    });
    const tags = out.map((r) => r.tag);
    expect(tags.slice(0, 2).sort()).toEqual(['frontend', 'react']);
    expect(tags).not.toContain('kubernetes');
  });

  test('bigram lets "machine learning" hit machine-learning', async () => {
    const out = await suggestTags(
      'applied machine learning',
      [{ tag: 'machine-learning', count: 1, inCatalog: false }],
      { minScore: 0.5 },
    );
    expect(out[0].tag).toBe('machine-learning');
    expect(out[0].score).toBe(1);
  });

  test('catalog membership boosts an otherwise-equal near-miss', async () => {
    const plain = await suggestTags(
      'frontend',
      [{ tag: 'front-end', count: 0, inCatalog: false }],
      { minScore: 0 },
    );
    const cat = await suggestTags('frontend', [{ tag: 'front-end', count: 0, inCatalog: true }], {
      minScore: 0,
    });
    expect(cat[0].score).toBeCloseTo(plain[0].score + CATALOG_BOOST, 5);
    expect(cat[0].inCatalog).toBe(true);
  });

  test('only ever returns supplied candidates (never invents)', async () => {
    const out = await suggestTags('built a totally novel quantum widget', vocab, { minScore: 0 });
    for (const r of out) expect(vocab.map((v) => v.tag)).toContain(r.tag);
  });

  test('minScore and limit are honored; empty text → []', async () => {
    expect(await suggestTags('', vocab)).toEqual([]);
    expect(await suggestTags('   ', vocab)).toEqual([]);
    const limited = await suggestTags('react frontend python kubernetes', vocab, {
      minScore: 0,
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  test('deterministic: identical input → identical output', async () => {
    const a = JSON.stringify(await suggestTags('react frontend', vocab));
    const b = JSON.stringify(await suggestTags('react frontend', vocab));
    expect(a).toBe(b);
  });
});

describe('suggestTags (pluggable scorer — Phase B seam)', () => {
  test('awaits the injected scorer, tags via:embedding, and applies catalog-first tie-break', async () => {
    const candidates = [
      { tag: 'a', count: 0, inCatalog: false },
      { tag: 'b', count: 0, inCatalog: true },
    ];
    // Stub returns equal scores → tie broken by catalog-first (b before a).
    const scorer = async (text, cands) => cands.map((c) => ({ tag: c.tag, score: 0.8 }));
    const out = await suggestTags('anything', candidates, { minScore: 0, scorer });
    expect(out.map((r) => r.tag)).toEqual(['b', 'a']);
    expect(out.every((r) => r.via === 'embedding')).toBe(true);
  });

  test('ignores scorer results for tags not in the candidate set', async () => {
    const scorer = async () => [{ tag: 'ghost', score: 0.99 }];
    const out = await suggestTags('x', [{ tag: 'real', count: 0, inCatalog: false }], {
      minScore: 0,
      scorer,
    });
    expect(out.map((r) => r.tag)).not.toContain('ghost');
  });
});
