/**
 * Formatting for the guides' reference tables: inches with centimeters alongside, computed here
 * so the two can never disagree.
 */
const CM_PER_INCH = 2.54;

export const cm = (inches: number): number => Math.round(inches * CM_PER_INCH);

/** `24 in (61 cm)` */
export const len = (inches: number): string => `${inches} in (${cm(inches)} cm)`;

/** `24–36 in (61–91 cm)` */
export const range = (from: number, to: number): string =>
  `${from}–${to} in (${cm(from)}–${cm(to)} cm)`;

/** `60 × 80 in (152 × 203 cm)` */
export const size = (w: number, d: number): string => `${w} × ${d} in (${cm(w)} × ${cm(d)} cm)`;

/** Feet and inches as plain text, e.g. 8.75 -> `8 ft 9 in`. */
export const feetInches = (feet: number): string => {
  let ft = Math.floor(feet);
  let inch = Math.round((feet - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
};

/**
 * Viewing distance (feet) at which a 16:9 screen of `diagonal` inches fills `degrees` of the
 * horizontal field of view: d = (width / 2) / tan(angle / 2).
 */
export const viewingDistanceFeet = (diagonal: number, degrees: number): number => {
  const width = diagonal * (16 / Math.hypot(16, 9));
  return width / 2 / Math.tan((degrees * Math.PI) / 360) / 12;
};
