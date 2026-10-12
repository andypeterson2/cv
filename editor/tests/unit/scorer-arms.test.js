/**
 * Which arm serves a request. Tested here rather than through the API because
 * whether the embedding module loads depends on an optional dependency, and a
 * test that boots the real server cannot take that away.
 */
const { pickScorer, AUTO } = require('../../lib/scorer-arms');

const FULL = ['lexical', 'embedding', 'embedding-ft'];
const BARE = ['lexical'];

test('naming nothing keeps the default the API has always documented', () => {
  expect(pickScorer(undefined, FULL)).toBe('lexical');
  expect(pickScorer(undefined, BARE)).toBe('lexical');
});

test('auto takes the best arm the deployment can serve', () => {
  expect(pickScorer(AUTO, FULL)).toBe('embedding');
  expect(pickScorer(AUTO, ['lexical', 'embedding-ft'])).toBe('embedding-ft');
  expect(pickScorer(AUTO, BARE)).toBe('lexical');
});

test('a pinned arm is served or refused, never swapped', () => {
  expect(pickScorer('embedding-ft', FULL)).toBe('embedding-ft');
  expect(pickScorer('lexical', BARE)).toBe('lexical');
  // null is the route's cue for a 501: a silent downgrade would label the rows
  // with a ranker that did not produce them.
  expect(pickScorer('embedding', BARE)).toBeNull();
  expect(pickScorer('embedding-ft', ['lexical', 'embedding'])).toBeNull();
});
