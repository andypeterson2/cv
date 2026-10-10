const { createKeyedLimiter } = require('../../lib/limiter');

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

describe('createKeyedLimiter', () => {
  test('runs one task per key at a time, other keys in parallel', async () => {
    const run = createKeyedLimiter({ maxPerKey: 1, maxQueuedPerKey: 3 });
    const gate = deferred();
    const order = [];
    const a1 = run('a', async () => {
      order.push('a1 start');
      await gate.promise;
      order.push('a1 end');
    });
    const a2 = run('a', async () => order.push('a2'));
    const b1 = run('b', async () => order.push('b1'));
    await b1;
    expect(order).toEqual(['a1 start', 'b1']);
    gate.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(['a1 start', 'b1', 'a1 end', 'a2']);
  });

  test('refuses a task past the per-key queue cap with code busy', async () => {
    const run = createKeyedLimiter({ maxPerKey: 1, maxQueuedPerKey: 1 });
    const gate = deferred();
    const first = run('a', () => gate.promise);
    const second = run('a', async () => 'queued');
    await expect(run('a', async () => 'over')).rejects.toMatchObject({ code: 'busy' });
    await expect(run('b', async () => 'other key')).resolves.toBe('other key');
    gate.resolve('done');
    await expect(first).resolves.toBe('done');
    await expect(second).resolves.toBe('queued');
    await expect(run('a', async () => 'after')).resolves.toBe('after');
  });

  test('a null key is not limited', async () => {
    const run = createKeyedLimiter({ maxPerKey: 1, maxQueuedPerKey: 0 });
    const results = await Promise.all([run(null, async () => 1), run(null, async () => 2)]);
    expect(results).toEqual([1, 2]);
  });
});
