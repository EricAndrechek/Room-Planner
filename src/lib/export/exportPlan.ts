/**
 * Browser side of "Export as image / PDF": PNG via <canvas>, PDF via the
 * in-house writer, and printing. Loaded lazily (dynamic import) the first time
 * the export dialog needs it, so it never weighs on the planner's main chunk.
 * Everything runs locally - works offline and within the CSP (blob:/data: images only).
 */
import type { Paper } from './paper';
import { deflate, pageFor, scenePdf, type RasterText } from './planPdf';
import { PLAN_FONT_STACK, sceneToSvg } from './planSvg';
import { buildPlanScene, type PlanInput, type Scene, type TextNode } from './scene';

/** Largest canvas we ask for (iOS Safari caps canvases at ~16.7 MP). */
const MAX_PIXELS = 16_000_000;

/** File name (without extension) from the project name: keeps Unicode, drops path/reserved characters. */
export const exportBaseName = (name: string): string => {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  const short = Array.from(cleaned).slice(0, 80).join('').trim();
  return short || 'floor-plan';
};

/** Device-pixel scale for the PNG: 3x, lowered for very large plans, never below 2x. */
export const pngScale = (scene: Pick<Scene, 'width' | 'height'>): number =>
  Math.max(2, Math.min(3, Math.sqrt(MAX_PIXELS / (scene.width * scene.height))));

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const loadSvgImage = async (svg: string): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type),
  );

/** The plan as a PNG blob at `scale` x its natural size. */
export const renderPng = async (scene: Scene, scale = pngScale(scene)): Promise<Blob> => {
  const img = await loadSvgImage(sceneToSvg(scene));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, 'image/png');
};

/** Render one text run with the system font, for text the PDF base fonts cannot encode. */
const rasterizeText = async (node: TextNode): Promise<RasterText | null> => {
  const SCALE = 10; // ~ 720 dpi at a typical print scale
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = `${node.bold ? '700 ' : ''}${node.size * SCALE}px ${PLAN_FONT_STACK}`;
  ctx.font = font;
  const m = ctx.measureText(node.text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent || node.size * SCALE * 0.9) + 2;
  const descent = Math.ceil(m.actualBoundingBoxDescent || node.size * SCALE * 0.25) + 2;
  const left = Math.floor(-(m.actualBoundingBoxLeft || 0)) - 2;
  const width = Math.ceil(Math.max(m.width, m.actualBoundingBoxRight || 0)) - left + 2;
  if (width <= 0 || ascent + descent <= 0) return null;
  canvas.width = width;
  canvas.height = ascent + descent;
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(node.text, -left, ascent);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
  const anchor = node.anchor === 'middle' ? m.width / 2 : node.anchor === 'end' ? m.width : 0;
  return {
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    alpha,
    left: (left - anchor) / SCALE,
    top: -ascent / SCALE,
    width: canvas.width / SCALE,
    height: canvas.height / SCALE,
  };
};

export const renderPdf = (scene: Scene, paper: Paper): Promise<Uint8Array> =>
  scenePdf(scene, { paper, rasterizeText, deflate });

export const downloadPng = async (input: PlanInput): Promise<void> => {
  const scene = buildPlanScene(input);
  downloadBlob(await renderPng(scene), `${exportBaseName(input.title)}.png`);
};

export const downloadPdf = async (input: PlanInput, paper: Paper): Promise<void> => {
  const scene = buildPlanScene(input);
  const pdf = await renderPdf(scene, paper);
  downloadBlob(
    new Blob([pdf as BlobPart], { type: 'application/pdf' }),
    `${exportBaseName(input.title)}.pdf`,
  );
};

// --- Printing -------------------------------------------------------------------------

const PRINT_ROOT_ID = 'print-plan';
const PRINT_STYLE_ID = 'print-plan-page';

/**
 * Put the plan SVG into a print-only container (see the `@media print` rules in
 * global.css), sized for the page orientation that fits it best. Used both by
 * the Print button and on `beforeprint`, so the browser's own Print menu also
 * prints a clean plan instead of the editor.
 */
export const preparePrint = (input: PlanInput): void => {
  const scene = buildPlanScene(input);
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
  }
  root.innerHTML = sceneToSvg(scene);
  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    document.head.appendChild(style);
  }
  const { landscape } = pageFor(scene, 'a4');
  style.textContent = `@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`;
  document.documentElement.classList.add('printing-plan');
};

export const cleanupPrint = (): void => {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.documentElement.classList.remove('printing-plan');
};

export const printPlan = (input: PlanInput): void => {
  preparePrint(input);
  window.addEventListener('afterprint', cleanupPrint, { once: true });
  window.print();
};
