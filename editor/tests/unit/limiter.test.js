const { createLimiter } = require('../../lib/limiter');

describe('createLimiter', () => {
  test('never runs more than `max` tasks concurrently', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          resolve();
        }, 10);
      });

    await Promise.all(Array.from({ length: 8 }, () => limit(task)));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('runs all queued tasks and preserves results + errors', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  test('a bad max coerces to at least 1', async () => {
    const limit = createLimiter(0);
    await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
