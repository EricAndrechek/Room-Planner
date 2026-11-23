/**
 * QR codes for "Open on another device": generated on the device (lean-qr's ~2 KB `nano` build,
 * loaded only when the Share dialog needs one), drawn as one SVG path. No network, no canvas, no
 * inline script or style, so it is CSP-safe.
 */

/** A generated code: `size` x `size` modules, `get(x, y)` true for a dark module. */
export interface QrMatrix {
  readonly size: number;
  get(x: number, y: number): boolean;
}

/**
 * Largest code we show (version 25: 117 x 117 modules, about 1,270 URL characters at error
 * correction L). Bigger codes get too dense to scan off a laptop screen at dialog size; the link is
 * then offered without a code. A typical plan link (~400-800 characters) needs version 12-18.
 */
export const QR_MAX_VERSION = 25;

/** QR version (1-40) of a code, from its size. */
export const qrVersion = (m: QrMatrix): number => (m.size - 17) / 4;

/**
 * The code for `text`, or null if it is too long to show. Error correction L (7%): the code is
 * read off a clean screen, never a damaged print, so the smallest (least dense) code is best;
 * lean-qr still raises the level when that costs no extra size.
 */
export async function makeQr(text: string): Promise<QrMatrix | null> {
  const { generate, correction } = await import('lean-qr/nano');
  let code: QrMatrix;
  try {
    code = generate(text, { minCorrectionLevel: correction.L });
  } catch {
    return null; // longer than any QR code can hold
  }
  return qrVersion(code) <= QR_MAX_VERSION ? code : null;
}

/** SVG path data (1 unit per module, no quiet zone): one rectangle per run of dark modules. */
export function qrPath(m: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.get(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.size && m.get(x, y)) x++;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join('');
}
