/**
 * Compares the previous and current contents of the hidden text field and
 * returns what changed at the end: how many characters were removed, then
 * which were added. Works on code points so emoji and other astral
 * characters count as one.
 *
 * The writing surface only ever appends or backspaces at the end, so a
 * change in the middle (from a paste over a selection, say) is treated as
 * deleting back to the first difference and retyping from there.
 */
export function diffText(prev: readonly string[], next: readonly string[]): { remove: number; add: string[] } {
  let i = 0;
  const n = Math.min(prev.length, next.length);
  while (i < n && prev[i] === next[i]) i++;
  return { remove: prev.length - i, add: next.slice(i) };
}

export function codePoints(text: string): string[] {
  return Array.from(text.replace(/\r\n?/g, '\n'));
}
