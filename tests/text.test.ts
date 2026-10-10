import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/text/wrap';

// Every character is 1 unit wide.
const measure = (s: string) => Array.from(s).length;

describe('wrapText', () => {
  it('breaks at spaces without leaving trailing spaces', () => {
    expect(wrapText('the wind will take it', 10, measure)).toEqual(['the wind', 'will take', 'it']);
  });

  it('keeps explicit line breaks and blank lines', () => {
    expect(wrapText('dear you\n\nthank you', 20, measure)).toEqual(['dear you', '', 'thank you']);
  });

  it('splits a word that is longer than a whole line', () => {
    expect(wrapText('aaaaaaaaaaaa', 5, measure)).toEqual(['aaaaa', 'aaaaa', 'aa']);
  });

  it('handles empty text', () => {
    expect(wrapText('', 10, measure)).toEqual(['']);
  });

  it('never produces a line wider than the limit when words fit', () => {
    const text = 'I never told you how much your letters meant to me when I was far from home';
    for (const line of wrapText(text, 16, measure)) expect(measure(line)).toBeLessThanOrEqual(16);
  });

  it('counts Japanese characters as single characters', () => {
    expect(wrapText('ありがとうございました', 4, measure)).toEqual(['ありがと', 'うござい', 'ました']);
  });
});
