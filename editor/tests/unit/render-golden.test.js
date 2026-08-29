/**
 * Golden equivalence — the keystone P0 test.
 *
 * The new render host (lib/render/host.renderVariant) driving the builtin
 * awesome-cv Nunjucks bundle must produce LaTeX equivalent to the legacy
 * lib/generator.generateAll(). The legacy generator is the ORACLE.
 *
 * The legacy path writes a multi-file document (\input{data.tex} + per-section
 * files); the new path renders one self-contained .tex. We compare by inlining
 * the oracle's \input{} files, then normalizing both: trim each line, drop
 * blank lines and full-line LaTeX comments (cosmetic — they don't affect the
 * PDF), leaving the meaningful command stream. Identical stream ⇒ identical PDF.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateAll } = require('../../lib/generator');
const { renderVariant } = require('../../lib/render/host');
const { makeKitchenSink } = require('../../lib/render/fixtures/kitchen-sink');

const BUILTIN = path.join(__dirname, '..', '..', 'layouts', 'awesome-cv');

function normalize(tex) {
  return tex
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('%'))
    .join('\n');
}

// Replace each `\input{file}` line with the referenced file's contents.
function inlineInputs(mainPath, buildDir) {
  return fs
    .readFileSync(mainPath, 'utf-8')
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^\\input\{([^}]+)\}$/);
      if (m) {
        const f = path.join(buildDir, m[1]);
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8');
      }
      return line;
    })
    .join('\n');
}

function oracleTex(compileData, tmp) {
  const buildDir = fs.mkdtempSync(path.join(tmp, 'oracle-'));
  const templatesDir = fs.mkdtempSync(path.join(tmp, 'tmpl-'));
  fs.writeFileSync(path.join(templatesDir, 'awesome-cv.cls'), '% fake', 'utf-8');
  const main = generateAll(compileData, buildDir, templatesDir, null);
  return inlineInputs(main, buildDir);
}

function newTex(compileData, tmp) {
  const buildDir = fs.mkdtempSync(path.join(tmp, 'new-'));
  const main = renderVariant(compileData, buildDir, { layoutDir: BUILTIN });
  return fs.readFileSync(main, 'utf-8');
}

const CASES = {
  'cv — default style': makeKitchenSink({ variant: 'cv' }),
  'resume — default style': makeKitchenSink({ variant: 'resume' }),
  'coverletter — default style': makeKitchenSink({ variant: 'coverletter' }),
  'cv — roboto + custom hex + a4 + custom spacing/fonts': makeKitchenSink({
    variant: 'cv',
    style: {
      fontFamily: 'roboto',
      accentColor: 'custom',
      customHex: '#123ABC',
      fontSize: '10pt',
      pageSize: 'a4paper',
    },
    spacing: { horizontalMargin: '2cm', itemsLeftMargin: '3ex', skillsColSep: '2ex' },
    fonts: { headerNameSize: '28pt', contentTextSize: '8.5pt' },
  }),
  'cv — preset accent': makeKitchenSink({ variant: 'cv', style: { accentColor: 'awesome-red' } }),
  'cv — legacy raw-hex accent': makeKitchenSink({
    variant: 'cv',
    style: { accentColor: '#ABCDEF' },
  }),
  'cv — empty accent (no color line)': makeKitchenSink({
    variant: 'cv',
    style: { accentColor: '' },
  }),
  'cv — empty personal + no sections': makeKitchenSink({
    variant: 'cv',
    personal: {},
    sections: [],
  }),
  'coverletter — no sections + empty fields': makeKitchenSink({
    variant: 'coverletter',
    personal: {},
    coverletter: { sections: [] },
  }),
};

describe('builtin awesome-cv layout reproduces legacy generator output', () => {
  let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  for (const [name, data] of Object.entries(CASES)) {
    it(name, () => {
      const expected = normalize(oracleTex(data, tmp));
      const actual = normalize(newTex(data, tmp));
      expect(actual).toBe(expected);
    });
  }

  // Normalization drops blank lines, so it cannot see a \par that has leaked
  // INTO a \cventry argument — which is fatal at compile time (awesome-cv's
  // \cventry is non-\long). Guard the raw output directly: no blank line may
  // sit immediately before an argument-position token.
  it('emits no blank line inside a \\cventry argument (raw output)', () => {
    const raw = newTex(makeKitchenSink({ variant: 'cv' }), tmp);
    const blankBeforeArg = /\n[ \t]*\n[ \t]*(\{|\\begin\{cvitems\}|\\item\b|\\end\{cvitems\})/;
    expect(blankBeforeArg.test(raw)).toBe(false);
  });
});
