import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { INITIAL_DOORS, INITIAL_ITEMS, INITIAL_ROOM, INITIAL_WINDOWS } from '../constants';
import { exportBaseName, pngScale } from './exportPlan';
import { defaultPaper, PAPER_SIZES } from './paper';
import { deflate, pageFor, scenePdf } from './planPdf';
import { buildPlanScene, type PlanInput } from './scene';

const input: PlanInput = {
  layout: {
    roomDims: INITIAL_ROOM,
    doors: INITIAL_DOORS,
    windows: INITIAL_WINDOWS,
    items: INITIAL_ITEMS,
  },
  unitSystem: 'ft-in',
  title: 'Café plan',
  date: new Date('2026-11-13T12:00:00Z'),
  locale: 'en-US',
};
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('scenePdf', () => {
  it('writes a valid single-page PDF with a correct cross-reference table', async () => {
    const pdf = latin1(await scenePdf(buildPlanScene(input), { paper: 'a4' }));
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets.length).toBeGreaterThanOrEqual(7);
    offsets.forEach((o, i) =>
      expect(pdf.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj\\n`)),
    );
    expect(pdf).toContain('/Type /Page ');
    expect(pdf).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    // Vector text, WinAnsi-encoded (é = \351), and the title in the document info.
    expect(pdf).toContain('(Bed) Tj');
    expect(pdf).toContain('(Caf\\351 plan) Tj');
    expect(pdf).toContain('/Title <FEFF00430061006600E900200070006C0061006E>');
  });

  it('fits the drawing to the paper in the better orientation', () => {
    expect(pageFor({ width: 1200, height: 800 }, 'a4')).toMatchObject({
      landscape: true,
      width: 841.89,
    });
    expect(pageFor({ width: 800, height: 1200 }, 'letter')).toMatchObject({
      landscape: false,
      width: 612,
    });
    const page = pageFor({ width: 1000, height: 1000 }, 'letter', 36);
    expect(1000 * page.scale).toBeCloseTo(612 - 72, 6);
    expect(PAPER_SIZES.a4.height).toBeCloseTo(841.89, 2);
  });

  it('escapes PDF string delimiters', async () => {
    const pdf = latin1(
      await scenePdf(buildPlanScene({ ...input, title: 'Room (1) \\ draft' }), { paper: 'letter' }),
    );
    expect(pdf).toContain('(Room \\(1\\) \\\\ draft) Tj');
  });

  it('compresses streams and embeds non-Latin text as images when given a rasterizer', async () => {
    const scene = buildPlanScene({ ...input, title: '卧室' });
    let calls = 0;
    const bytes = await scenePdf(scene, {
      paper: 'a4',
      deflate,
      rasterizeText: async (node) => {
        calls++;
        expect(node.text).toBe('卧室');
        return {
          pixelWidth: 4,
          pixelHeight: 2,
          alpha: new Uint8Array(8).fill(255),
          left: 0,
          top: -20,
          width: 40,
          height: 24,
        };
      },
    });
    expect(calls).toBe(1);
    const pdf = latin1(bytes);
    expect(pdf).toContain('/Filter /FlateDecode');
    expect(pdf).toMatch(/\/XObject << \/Im1 \d+ 0 R >>/);
    expect(pdf).toMatch(/\/SMask \d+ 0 R/);
    // The content stream inflates and draws the image.
    const start = pdf.indexOf('stream\n', pdf.indexOf('4 0 obj')) + 7;
    const length = Number(pdf.slice(pdf.indexOf('4 0 obj')).match(/\/Length (\d+)/)![1]);
    const content = inflateSync(Buffer.from(bytes.slice(start, start + length))).toString('latin1');
    expect(content).toContain('/Im1 Do');
    expect(content).not.toContain('Tj\n'.repeat(0) + '(??) Tj');
  });
});

describe('export helpers', () => {
  it('derives safe file names from project names', () => {
    expect(exportBaseName('My Bedroom')).toBe('My Bedroom');
    expect(exportBaseName('a/b\\c:d*e?"f"<g>|h')).toBe('a b c d e f g h');
    expect(exportBaseName('Спальня 卧室 🛏️')).toBe('Спальня 卧室 🛏️');
    expect(exportBaseName('  ...  ')).toBe('floor-plan');
    expect(exportBaseName('')).toBe('floor-plan');
    expect(Array.from(exportBaseName('x'.repeat(200)))).toHaveLength(80);
  });

  it('chooses Letter for US-style locales and A4 elsewhere', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('fr-CA')).toBe('letter');
    expect(defaultPaper('en-GB')).toBe('a4');
    expect(defaultPaper('de')).toBe('a4');
    expect(defaultPaper('zh-Hans-CN')).toBe('a4');
    expect(defaultPaper(undefined)).toBe('a4');
  });

  it('renders PNGs at 2-3x, within mobile canvas limits', () => {
    expect(pngScale({ width: 1000, height: 900 })).toBe(3);
    expect(pngScale({ width: 2400, height: 2000 })).toBe(2);
    const s = pngScale({ width: 1600, height: 1500 });
    expect(1600 * 1500 * s * s).toBeLessThanOrEqual(16_000_000);
  });
});
