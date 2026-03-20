const { extractBraceArgs, findCommand } = require('../../lib/braceExtractor');

describe('extractBraceArgs', () => {
  test('extracts a single brace argument', () => {
    const result = extractBraceArgs('{hello}', 0, 1);
    expect(result.args).toEqual(['hello']);
    expect(result.endIndex).toBe(7);
  });

  test('extracts multiple brace arguments', () => {
    const result = extractBraceArgs('{hello}{world}', 0, 2);
    expect(result.args).toEqual(['hello', 'world']);
    expect(result.endIndex).toBe(14);
  });

  test('handles nested braces', () => {
    const result = extractBraceArgs('{wor{l}d}', 0, 1);
    expect(result.args).toEqual(['wor{l}d']);
  });

  test('handles deeply nested braces', () => {
    const result = extractBraceArgs('{a{b{c}d}e}', 0, 1);
    expect(result.args).toEqual(['a{b{c}d}e']);
  });

  test('handles empty brace arguments', () => {
    const result = extractBraceArgs('{}{}', 0, 2);
    expect(result.args).toEqual(['', '']);
  });

  test('skips whitespace between arguments', () => {
    const result = extractBraceArgs('{first}  \n  {second}', 0, 2);
    expect(result.args).toEqual(['first', 'second']);
  });

  test('starts from given index', () => {
    const result = extractBraceArgs('skip{actual}', 4, 1);
    expect(result.args).toEqual(['actual']);
  });

  test('throws on insufficient arguments', () => {
    expect(() => extractBraceArgs('{only}', 0, 2)).toThrow('Expected 2 brace args');
  });

  test('throws on unmatched opening brace', () => {
    expect(() => extractBraceArgs('{unclosed', 0, 1)).toThrow('Unmatched brace');
  });

  test('handles arguments with LaTeX commands', () => {
    const result = extractBraceArgs('{\\textbf{bold} text}', 0, 1);
    expect(result.args).toEqual(['\\textbf{bold} text']);
  });

  test('handles real cventry-style arguments', () => {
    const input = '{Position}{Organization}{Location}{Date}{Description}';
    const result = extractBraceArgs(input, 0, 5);
    expect(result.args).toEqual(['Position', 'Organization', 'Location', 'Date', 'Description']);
  });
});

describe('findCommand', () => {
  test('finds a simple command with arguments', () => {
    const results = findCommand('\\cvskill{Lang}{Python}', 'cvskill', 2);
    expect(results).toHaveLength(1);
    expect(results[0].args).toEqual(['Lang', 'Python']);
  });

  test('finds multiple occurrences', () => {
    const tex = '\\cvskill{A}{B}\n\\cvskill{C}{D}';
    const results = findCommand(tex, 'cvskill', 2);
    expect(results).toHaveLength(2);
    expect(results[0].args).toEqual(['A', 'B']);
    expect(results[1].args).toEqual(['C', 'D']);
  });

  test('does not match partial command names', () => {
    const results = findCommand('\\cvskillz{A}{B}', 'cvskill', 2);
    expect(results).toHaveLength(0);
  });

  test('matches command followed by non-letter', () => {
    const results = findCommand('\\cvskill\n{A}{B}', 'cvskill', 2);
    expect(results).toHaveLength(1);
    expect(results[0].args).toEqual(['A', 'B']);
  });

  test('skips malformed commands gracefully', () => {
    const tex = '% \\cvskill{incomplete\n\\cvskill{A}{B}';
    const results = findCommand(tex, 'cvskill', 2);
    // The comment one may fail to parse, but the valid one should be found
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[results.length - 1].args).toEqual(['A', 'B']);
  });

  test('handles command with nested braces in arguments', () => {
    const tex = '\\cventry{\\textbf{Bold}}{Org}{Loc}{Date}{Items}';
    const results = findCommand(tex, 'cventry', 5);
    expect(results).toHaveLength(1);
    expect(results[0].args[0]).toBe('\\textbf{Bold}');
  });

  test('returns empty array when no matches', () => {
    const results = findCommand('no commands here', 'cvskill', 2);
    expect(results).toHaveLength(0);
  });

  test('tracks startIndex and endIndex correctly', () => {
    const tex = '\\name{First}{Last}';
    const results = findCommand(tex, 'name', 2);
    expect(results).toHaveLength(1);
    expect(results[0].startIndex).toBe(0);
    expect(results[0].endIndex).toBe(18);
  });
});
