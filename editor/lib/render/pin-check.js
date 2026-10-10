/**
 * The check run when an account pins someone else's layout: compile it against two
 * of that account's own résumés. Publishing only proved the layout works for its
 * author's data, so the pinner sees what breaks for theirs. The result is stored
 * as the pinner's own report and returned as warnings; it never blocks the pin.
 */
const { verifyLayout, gatherSamples } = require('./verify');
const { layoutDirForRow } = require('./layouts');

async function pinCheck(db, layout, userId, { assetsDir }) {
  if (!layout || layout.builtin || layout.userId === userId) return [];
  const samples = gatherSamples(db, { userId, maxSamples: 2 });
  if (samples.length === 0) return [];
  const report = await verifyLayout(layoutDirForRow(layout), {
    assetsDir,
    samples,
    fixtures: false,
    compileKey: userId,
  });
  db.setLayoutReport(layout.id, userId, report);
  return report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
}

module.exports = { pinCheck };
