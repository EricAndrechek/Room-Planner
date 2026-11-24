import { describe, expect, it } from 'vitest';
import { buildPlanUrl } from '../core/share/plan';
import { starterPlan, withDoc } from './plans';
import { QR_MAX_VERSION, makeQr, qrPath, qrVersion, type QrMatrix } from './qr';

const matrix = (rows: string[]): QrMatrix => ({
  size: rows.length,
  get: (x, y) => rows[y]![x] === '#',
});

describe('qrPath', () => {
  it('draws one rectangle per run of dark modules', () => {
    expect(qrPath(matrix(['##.', '.#.', '..#']))).toBe('M0 0h2v1h-2zM1 1h1v1h-1zM2 2h1v1h-1z');
  });

  it('is empty for an all-light code', () => {
    expect(qrPath(matrix(['..', '..']))).toBe('');
  });
});

describe('makeQr', () => {
  it('encodes a typical plan link in a code small enough to scan off a screen', async () => {
    const url = await buildPlanUrl(
      'https://room-planner.andrechek.com/',
      withDoc(starterPlan(), 'My bedroom', 'ft-in'),
    );
    const code = (await makeQr(url))!;
    expect(code).not.toBeNull();
    // The compact plan form: version 15 for the v3 link of the same plan (section 5).
    expect(qrVersion(code)).toBeLessThanOrEqual(11);
  });

  it('handles a ~600-character link', async () => {
    const url = `https://room-planner.andrechek.com/#s=${'a1B2_-'.repeat(95)}`;
    expect(url.length).toBeGreaterThan(600);
    const code = (await makeQr(url))!;
    expect(code).not.toBeNull();
    expect(qrVersion(code)).toBeLessThanOrEqual(QR_MAX_VERSION);
  });

  it('gives up (null) on a link too long to scan comfortably', async () => {
    expect(await makeQr(`https://x.test/#s=${'x'.repeat(1500)}`)).toBeNull();
    expect(await makeQr(`https://x.test/#s=${'x'.repeat(5000)}`)).toBeNull();
  });
});
