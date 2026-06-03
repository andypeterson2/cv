/**
 * Unit tests for the pure cosine ranking core (lib/cosine) used by the optional
 * embedding scorer. No model, no dependency — fixed-vector fixtures only.
 */

const { cosineSim, cosineRank } = require('../../lib/cosine');

describe('cosineSim', () => {
  test('identical → 1, orthogonal → 0, opposite → -1', () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  test('zero vector → 0 (no divide-by-zero)', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });

  test('magnitude-invariant', () => {
    expect(cosineSim([2, 0], [5, 0])).toBeCloseTo(1, 6);
  });
});

describe('cosineRank', () => {
  test('orders by similarity to the query', () => {
    const q = [1, 0];
    const cands = [
      { tag: 'far', vec: [0, 1] },
      { tag: 'near', vec: [1, 0.1] },
      { tag: 'mid', vec: [1, 1] },
    ];
    expect(cosineRank(q, cands).map((r) => r.tag)).toEqual(['near', 'mid', 'far']);
  });

  test('deterministic tie-break by tag asc at equal score', () => {
    const q = [1, 0];
    const cands = [
      { tag: 'zebra', vec: [1, 0] },
      { tag: 'alpha', vec: [1, 0] },
    ];
    expect(cosineRank(q, cands).map((r) => r.tag)).toEqual(['alpha', 'zebra']);
  });
});
