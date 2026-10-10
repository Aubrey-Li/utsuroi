/**
 * Breaks text into lines no wider than `maxWidth`, at spaces where possible.
 * Honors explicit line breaks. A word longer than a whole line is split by
 * character. `measure` returns the width of a string in the same units.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/( +)/).filter((w) => w.length > 0);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measure(candidate.trimEnd()) <= maxWidth || line.trim() === '') {
        if (measure(candidate.trimEnd()) <= maxWidth) {
          line = candidate;
          continue;
        }
        // A single word wider than the line: split it by character.
        for (const ch of Array.from(word)) {
          if (measure((line + ch).trimEnd()) > maxWidth && line.trim() !== '') {
            lines.push(line.trimEnd());
            line = '';
          }
          line += ch;
        }
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trim() === '' ? '' : word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
