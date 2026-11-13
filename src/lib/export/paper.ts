/** Paper sizes for the PDF export (kept tiny: the export dialog imports this eagerly). */
export type Paper = 'a4' | 'letter';

/** Page sizes in PDF points (1/72 in), portrait. */
export const PAPER_SIZES: Record<Paper, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/** Regions that use US Letter; everywhere else uses A4. */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR']);

/** Default paper for a BCP 47 locale such as `en-US` or `de-DE`. */
export const defaultPaper = (locale: string | undefined): Paper => {
  const region = locale?.match(/[-_]([A-Za-z]{2})(?:$|[-_])/)?.[1]?.toUpperCase();
  return region && LETTER_REGIONS.has(region) ? 'letter' : 'a4';
};
