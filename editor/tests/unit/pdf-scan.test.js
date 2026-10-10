const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findForbidden, scanPdf } = require('../../lib/render/pdf-scan');

describe('findForbidden', () => {
  test('a résumé-shaped PDF has nothing to flag', () => {
    const objects = {
      'obj:1 0 R': { value: { '/Type': '/Catalog', '/OpenAction': ['3 0 R', '/Fit'] } },
      'obj:2 0 R': {
        value: { '/Subtype': '/Link', '/A': { '/S': '/URI', '/URI': 'u:https://x' } },
      },
      'obj:3 0 R': { value: { '/Type': '/Page' } },
    };
    expect(findForbidden(objects)).toEqual([]);
  });

  test('flags scripts, auto-run actions and embedded files', () => {
    const objects = {
      'obj:1 0 R': {
        value: { '/OpenAction': { '/S': '/JavaScript', '/JS': 'u:app.alert(1)' } },
      },
      'obj:2 0 R': { value: { '/Names': { '/EmbeddedFiles': '9 0 R' } } },
      'obj:3 0 R': { value: { '/AA': { '/O': { '/S': '/Launch' } } } },
    };
    expect(findForbidden(objects)).toEqual([
      '/AA',
      '/EmbeddedFiles',
      '/JS',
      '/OpenAction',
      '/S /JavaScript',
      '/S /Launch',
    ]);
  });
});

const has = (cmd, arg) => {
  try {
    execFileSync(cmd, [arg], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!has('qpdf', '--version') || !has('xelatex', '--version'))('scanPdf', () => {
  test('finds a JavaScript OpenAction written through \\special', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-scan-'));
    fs.writeFileSync(
      path.join(dir, 'bad.tex'),
      '\\documentclass{article}\\begin{document}hi' +
        '\\special{pdf:put @catalog <</OpenAction <</S/JavaScript/JS(app.alert(1))>> >>}' +
        '\\end{document}',
    );
    execFileSync('xelatex', ['-interaction=batchmode', 'bad.tex'], { cwd: dir, stdio: 'ignore' });
    const found = await scanPdf(path.join(dir, 'bad.pdf'));
    expect(found.forbidden).toEqual(expect.arrayContaining(['/OpenAction', '/S /JavaScript']));
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
