/**
 * Neighbour votes: a profile's similar tagged bullets lift their tags, the
 * bullet itself never votes, and too little history leaves the base scores.
 */
const { withNeighbours, ALPHA, MIN_EXAMPLES } = require('../../lib/neighbour-scorer');

// Two-dimensional "embeddings": quantum bullets point one way, web bullets the other.
const VECS = {
  'Built a BB84 key exchange': [1, 0],
  'Simulated a lossy quantum channel': [0.95, 0.05],
  'Measured QBER on the bench': [0.9, 0.1],
  'Styled the landing page': [0, 1],
  'Ran Grover search on IBM hardware': [0.97, 0.03],
};
const embed = async (text) => VECS[text];
const examples = [
  { text: 'Built a BB84 key exchange', tags: ['qkd'] },
  { text: 'Simulated a lossy quantum channel', tags: ['qkd', 'simulation'] },
  { text: 'Measured QBER on the bench', tags: ['qkd'] },
  { text: 'Styled the landing page', tags: ['frontend'] },
];
const candidates = ['qkd', 'simulation', 'frontend'].map((tag) => ({ tag }));
// The base scorer knows nothing about "qkd": a made-up tag with no textual match.
const base = async () => [
  { tag: 'qkd', score: 0.1 },
  { tag: 'simulation', score: 0.3 },
  { tag: 'frontend', score: 0.2 },
];

describe('withNeighbours', () => {
  test("similar tagged bullets carry the profile's own tag to new text", async () => {
    const scorer = withNeighbours(base, embed, examples);
    const out = await scorer('Ran Grover search on IBM hardware', candidates);
    const top = [...out].sort((a, b) => b.score - a.score)[0];
    expect(top.tag).toBe('qkd');
    expect(out.find((r) => r.tag === 'frontend').score).toBeLessThan(top.score);
  });

  test('scores blend the base score with the vote share', async () => {
    const scorer = withNeighbours(base, embed, examples);
    const out = await scorer('Ran Grover search on IBM hardware', candidates);
    const qkd = out.find((r) => r.tag === 'qkd').score;
    expect(qkd).toBeGreaterThan(ALPHA * 0.1);
    expect(qkd).toBeLessThanOrEqual(ALPHA * 0.1 + (1 - ALPHA));
  });

  test('a bullet being re-tagged does not vote for itself', async () => {
    const own = [{ text: 'Styled the landing page', tags: ['frontend'] }, ...examples.slice(0, 3)];
    const scorer = withNeighbours(base, embed, own);
    const out = await scorer('Styled the landing page', candidates);
    // Only the three quantum bullets vote, so frontend gets no neighbour share.
    expect(out.find((r) => r.tag === 'frontend').score).toBeCloseTo(ALPHA * 0.2);
  });

  test('with too little history the base scores pass through unchanged', async () => {
    const scorer = withNeighbours(base, embed, examples.slice(0, MIN_EXAMPLES - 1));
    expect(await scorer('Ran Grover search on IBM hardware', candidates)).toEqual(await base());
  });

  test('a blend weight of 1 discards the votes', async () => {
    const scorer = withNeighbours(base, embed, examples, { alpha: 1 });
    expect(await scorer('Ran Grover search on IBM hardware', candidates)).toEqual(await base());
  });

  test('a swept blend weight replaces ALPHA in the score', async () => {
    const scorer = withNeighbours(base, embed, examples, { alpha: 0.2 });
    const out = await scorer('Ran Grover search on IBM hardware', candidates);
    const qkd = out.find((r) => r.tag === 'qkd').score;
    expect(qkd).toBeGreaterThan(0.2 * 0.1);
    expect(qkd).toBeLessThanOrEqual(0.2 * 0.1 + 0.8);
  });

  test('k bounds how many neighbours vote', async () => {
    const scorer = withNeighbours(base, embed, examples, { k: 1 });
    const out = await scorer('Ran Grover search on IBM hardware', candidates);
    // One neighbour votes, carrying both of its tags at the full share, so the
    // web bullet is out of range and frontend keeps the bare base score.
    expect(out.find((r) => r.tag === 'qkd').score).toBeCloseTo(ALPHA * 0.1 + (1 - ALPHA));
    expect(out.find((r) => r.tag === 'simulation').score).toBeCloseTo(ALPHA * 0.3 + (1 - ALPHA));
    expect(out.find((r) => r.tag === 'frontend').score).toBeCloseTo(ALPHA * 0.2);
    // With every neighbour voting (the default k) the web bullet does get a share.
    const all = await withNeighbours(
      base,
      embed,
      examples,
    )('Ran Grover search on IBM hardware', candidates);
    expect(all.find((r) => r.tag === 'frontend').score).toBeGreaterThan(ALPHA * 0.2);
  });

  test('a lower minExamples lets a short history vote', async () => {
    const short = examples.slice(0, MIN_EXAMPLES - 1);
    const scorer = withNeighbours(base, embed, short, { minExamples: 1 });
    const out = await scorer('Ran Grover search on IBM hardware', candidates);
    expect(out.find((r) => r.tag === 'qkd').score).toBeGreaterThan(ALPHA * 0.1);
  });
});
