/**
 * Real-compile text-layer check: renders the seeded Jane Doe profile with every
 * builtin layout and font, compiles it with xelatex, and requires
 * the pdftotext output to match the source text. Skips without xelatex or
 * pdftotext (CI has neither; the container and a local TeX install have both).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CvDatabase = require('../../lib/db');
const { renderVariant } = require('../../lib/render/host');
const { queuedCompile } = require('../../lib/render/latex');
const { buildContext } = require('../../lib/render/context');
const { extractText, checkText } = require('../../lib/render/text-check');

function hasBin(cmd, arg) {
  try {
    execFileSync(cmd, [arg], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canCompile = hasBin('xelatex', '--version') && hasBin('pdftotext', '-v');
const LAYOUTS = path.join(__dirname, '..', '..', 'layouts');
const STYLES = [{}, { fontFamily: 'roboto' }];

describe.skipIf(!canCompile)('PDF text layer (Jane Doe)', () => {
  const db = new CvDatabase(':memory:');
  const pid = db.getProfiles()[0].id;
  const variants = db.getVariants(pid);
  let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'text-layer-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cases = [];
  for (const layout of ['awesome-cv', 'classic']) {
    for (const kind of ['cv', 'resume', 'coverletter']) {
      for (const style of STYLES) cases.push({ layout, kind, style });
    }
  }

  it.each(cases)(
    '$layout $kind $style extracts as written',
    async ({ layout, kind, style }) => {
      const data = db.resolveVariant(variants.find((v) => v.kind === kind).id);
      data.style = { ...data.style, ...style };
      const dir = fs.mkdtempSync(path.join(tmp, `${layout}-${kind}-`));
      const main = renderVariant(data, dir, { layoutDir: path.join(LAYOUTS, layout) });
      const result = await queuedCompile(dir, path.basename(main));
      expect(result.ok).toBe(true);
      expect(result.log).not.toMatch(/Missing character/);
      const ctx = buildContext(data);
      const text = await extractText(result.pdfPath);
      const { issues } = checkText(ctx, text);
      expect(issues).toEqual([]);
      if (kind !== 'coverletter') {
        expect(text).toContain('github.com/janedoe');
        expect(text).toContain('linkedin.com/in/janedoe');
      }
    },
    60_000,
  );
});
