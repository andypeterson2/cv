/**
 * Core utility: extract N brace-delimited arguments from a LaTeX string.
 * Handles nested braces correctly by tracking depth.
 */

/**
 * Starting from `startIndex`, find the next `{` and extract `count` top-level
 * brace groups. Returns { args: string[], endIndex: number }.
 *
 * Example: extractBraceArgs("{hello}{wor{l}d}", 0, 2)
 *   => { args: ["hello", "wor{l}d"], endIndex: 16 }
 */
function extractBraceArgs(text, startIndex, count) {
  const args = [];
  let i = startIndex;

  for (let n = 0; n < count; n++) {
    // Find the next opening brace
    while (i < text.length && text[i] !== '{') {
      i++;
    }
    if (i >= text.length) {
      throw new Error(`Expected ${count} brace args, found ${n} (ran out of text at index ${i})`);
    }

    // Extract content between matching braces
    let depth = 0;
    const contentStart = i + 1;
    let contentEnd = -1;

    for (; i < text.length; i++) {
      if (text[i] === '{') {
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          contentEnd = i;
          i++; // move past closing brace
          break;
        }
      }
    }

    if (contentEnd === -1) {
      throw new Error(`Unmatched brace starting at index ${contentStart - 1}`);
    }

    args.push(text.substring(contentStart, contentEnd));
  }

  return { args, endIndex: i };
}

/**
 * Find all occurrences of a command and extract its brace arguments.
 * Returns array of { args: string[], startIndex, endIndex }.
 *
 * Example: findCommand("\\cvskill{Lang}{Python}", "cvskill", 2)
 *   => [{ args: ["Lang", "Python"], startIndex: 0, endIndex: 22 }]
 */
function findCommand(text, commandName, argCount) {
  const results = [];
  const pattern = new RegExp(`\\\\${commandName}(?![a-zA-Z])`, 'g');
  let match;

  while ((match = pattern.exec(text)) !== null) {
    try {
      const { args, endIndex } = extractBraceArgs(text, match.index + match[0].length, argCount);
      results.push({ args, startIndex: match.index, endIndex });
    } catch (e) {
      // Skip malformed commands (e.g., in comments)
    }
  }

  return results;
}

module.exports = { extractBraceArgs, findCommand };
