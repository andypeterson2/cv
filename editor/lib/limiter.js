/**
 * Minimal in-process concurrency limiter (no dependencies; CommonJS-friendly,
 * unlike p-limit which is ESM-only). Caps how many async tasks run at once; the
 * rest queue. Used to bound concurrent xelatex compiles so a burst of /pdf
 * requests cannot fork an unbounded number of LaTeX processes.
 */
function createLimiter(maxConcurrent) {
  const max = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;
  const queue = [];

  const drain = () => {
    while (active < max && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  };

  return function run(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      drain();
    });
  };
}

/**
 * Per-key concurrency on top of a shared limiter: each key (an account) runs at
 * most `maxPerKey` tasks at once and may queue at most `maxQueuedPerKey` more. A
 * task over the queue cap is refused with an Error whose code is 'busy', so one
 * account cannot fill the shared slots for everyone else.
 */
function createKeyedLimiter({ maxPerKey = 1, maxQueuedPerKey = 3 } = {}) {
  const perKey = new Map();
  return function run(key, task) {
    if (key == null) return Promise.resolve().then(task);
    let entry = perKey.get(key);
    if (!entry) {
      entry = { limit: createLimiter(maxPerKey), pending: 0 };
      perKey.set(key, entry);
    }
    if (entry.pending >= maxPerKey + maxQueuedPerKey) {
      const err = new Error('Too many compiles in progress for this account');
      err.code = 'busy';
      return Promise.reject(err);
    }
    entry.pending++;
    return entry.limit(task).finally(() => {
      entry.pending--;
      if (entry.pending === 0) perKey.delete(key);
    });
  };
}

module.exports = { createLimiter, createKeyedLimiter };
