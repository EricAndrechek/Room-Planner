/**
 * Text metrics and encoding for the PDF's built-in Helvetica fonts.
 *
 * The exported plan sizes and truncates labels with these widths so that the
 * SVG/PNG (drawn with the system sans-serif, which is metrically close to
 * Helvetica/Arial) and the PDF (drawn with the PDF base-14 Helvetica) lay out
 * the same way. Widths are the Adobe AFM values, in 1/1000 em.
 */

// prettier-ignore
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // '0'..'?'
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // '@'..'O'
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 'P'..'_'
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // '`'..'o'
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 'p'..'~'
];

// prettier-ignore
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Widths of the non-ASCII characters the plan itself draws (both weights). */
const SPECIAL: Record<string, number> = {
  '×': 584,
  '·': 278,
  '²': 333,
  '…': 1000,
  '–': 556,
  '—': 1000,
  '°': 400,
  '’': 222,
  '‘': 222,
  '“': 333,
  '”': 333,
};

/** Unicode code points of the 0x80-0x9F block of WinAnsiEncoding (cp1252). */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** WinAnsiEncoding byte for a character, or null if the base-14 fonts cannot draw it. */
export const winAnsiByte = (ch: string): number | null => {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return CP1252_HIGH[cp] ?? null;
};

/** Whether every character of `text` can be drawn with the PDF base-14 fonts. */
export const isWinAnsi = (text: string): boolean => {
  for (const ch of text) if (winAnsiByte(ch) === null) return false;
  return true;
};

const charWidth = (ch: string, bold: boolean): number => {
  const cp = ch.codePointAt(0)!;
  const table = bold ? BOLD : REGULAR;
  if (cp >= 0x20 && cp <= 0x7e) return table[cp - 0x20]!;
  const special = SPECIAL[ch];
  if (special !== undefined) return special;
  // Accented Latin letters are as wide as their base letter.
  const base = ch.normalize('NFD')[0];
  if (base && base !== ch) {
    const b = base.codePointAt(0)!;
    if (b >= 0x20 && b <= 0x7e) return table[b - 0x20]!;
  }
  // CJK and other wide scripts take about a full em; everything else ~ a digit.
  if (
    cp >= 0x1100 &&
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Extended_Pictographic}/u.test(
      ch,
    )
  )
    return 1000;
  return 556;
};

/** Approximate advance width of `text` at `size`, in the same units as `size`. */
export const measureText = (text: string, size: number, bold = false): number => {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w * size) / 1000;
};

/** User-perceived characters, so truncation never splits an emoji or accent. */
const graphemes = (text: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (s) => s.segment,
      )
    : Array.from(text);

/**
 * `text` shortened with an ellipsis so it measures at most `maxWidth`, or ''
 * when not even one character and the ellipsis fit.
 */
export const fitText = (text: string, maxWidth: number, size: number, bold = false): string => {
  if (measureText(text, size, bold) <= maxWidth) return text;
  const chars = graphemes(text);
  for (let n = chars.length - 1; n >= 1; n--) {
    const candidate = `${chars.slice(0, n).join('').trimEnd()}…`;
    if (measureText(candidate, size, bold) <= maxWidth) return candidate;
  }
  return '';
};
