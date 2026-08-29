/**
 * Shared xelatex runner + a process-wide concurrency cap.
 *
 * Both the compile route and the verification harness funnel through here, so a
 * burst of compiles (or a verify, which compiles several fixtures) queues behind
 * one global limiter instead of forking N xelatex processes at once. Always
 * --no-shell-escape; the per-run timeout bounds a runaway document.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createLimiter } = require('../limiter');

const COMPILE_TIMEOUT_MS = Number(process.env.CV_COMPILE_TIMEOUT_MS) || 30000;
const compileLimit = createLimiter(Number(process.env.CV_COMPILE_CONCURRENCY) || 2);

/** Run xelatex once in buildDir. Resolves {ok, pdfPath, log, pages}. Never rejects. */
function runLatex(buildDir, mainTexFile, { timeoutMs = COMPILE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile('fc-cache', ['-f', buildDir], { timeout: 5000 }, () => {
      execFile(
        'xelatex',
        [
          '--no-shell-escape',
          '-interaction=nonstopmode',
          '-halt-on-error',
          path.basename(mainTexFile),
        ],
        // SECURITY: openin_any/openout_any=p (kpathsea "paranoid") confines file
        // reads/writes to buildDir — no absolute paths, no `..`, no dotfiles. Combined
        // with --no-shell-escape, this blocks LaTeX-injection exfil (e.g. a CV field
        // value of \input{/etc/passwd} or \openin on /proc/self/environ) from reading
        // server files into the PDF/log. Relative \input of the layout's own files in
        // buildDir, and \usepackage from the texmf tree, are unaffected.
        {
          cwd: buildDir,
          timeout: timeoutMs,
          env: { ...process.env, openin_any: 'p', openout_any: 'p' },
        },
        (error, stdout, stderr) => {
          const log = stdout + (stderr ? '\n' + stderr : '');
          const pdfPath = path.join(buildDir, path.basename(mainTexFile, '.tex') + '.pdf');
          if (error || !fs.existsSync(pdfPath)) {
            resolve({ ok: false, pdfPath: null, log, pages: 0 });
          } else {
            resolve({ ok: true, pdfPath, log, pages: pagesFromLog(log) });
          }
        },
      );
    });
  });
}

/** xelatex prints "Output written on cv.pdf (4 pages, 57604 bytes)." */
function pagesFromLog(log) {
  const m = /Output written on .+?\((\d+) pages?/.exec(log || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** Queue a compile behind the shared concurrency cap. */
function queuedCompile(buildDir, mainTexFile, opts) {
  return compileLimit(() => runLatex(buildDir, mainTexFile, opts));
}

module.exports = { runLatex, queuedCompile, compileLimit, pagesFromLog, COMPILE_TIMEOUT_MS };
