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

module.exports = { createLimiter };
