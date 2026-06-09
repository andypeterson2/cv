/**
 * Worker entry for isolated template rendering. Runs an untrusted layout's
 * Nunjucks render off the main event loop so a runaway template (infinite loop)
 * can be killed by terminate() without hanging the server. Used by the
 * verification gate, where candidate templates first execute (see engine.renderInWorker).
 */
const { parentPort, workerData } = require('worker_threads');
const { renderTemplate } = require('./engine');

try {
  const out = renderTemplate(workerData.layoutDir, workerData.entryRel, workerData.context);
  parentPort.postMessage({ ok: true, out });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) });
}
