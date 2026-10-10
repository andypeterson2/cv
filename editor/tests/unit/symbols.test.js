const { SYMBOLS } = require('../../lib/symbols');
const { symbolFallback } = require('../../lib/render/filters');

describe('symbol list', () => {
  it('has one row per command, each a single character', () => {
    const cmds = SYMBOLS.map((s) => s.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
    for (const s of SYMBOLS) {
      expect(s.cmd).toMatch(/^\\[a-zA-Z]+$/);
      expect([...s.glyph]).toHaveLength(1);
    }
  });
});

describe('symbolFallback', () => {
  it('maps every distinct glyph to the fallback font when the current font lacks it', () => {
    const out = symbolFallback();
    const glyphs = new Set(SYMBOLS.map((s) => s.glyph));
    const lines = out.split('\n').filter((l) => l.trim().startsWith('\\newunicodechar'));
    expect(lines).toHaveLength(glyphs.size);
    expect(out).toMatch(/@ifpackageloaded\{unicode-math\}\{\}\{%\n {2}\\newunicodechar\{∑\}/);
    expect(out).toContain(
      '\\newunicodechar{→}{\\iffontchar\\font"2192 \\char"2192 \\else{\\cvsymfallback\\char"2192}\\fi}',
    );
  });
});
