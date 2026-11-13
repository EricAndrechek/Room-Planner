/**
 * A minimal, dependency-free PDF 1.4 writer for the plan scene: one page,
 * vector paths, text in the PDF base-14 Helvetica fonts (no font embedding),
 * fitted to A4 or Letter with the orientation that best fits the drawing.
 *
 * Text the base-14 fonts cannot encode (anything outside Windows-1252, e.g.
 * Cyrillic, CJK, emoji) is drawn as a high-resolution image of that one text
 * run when a `rasterizeText` callback is given (the browser supplies one that
 * renders with the system font); everything else stays vector.
 */
import { isWinAnsi, measureText, winAnsiByte } from './fontMetrics';
import { PAPER_SIZES, type Paper } from './paper';
import type { PathCommand, Rotation, Scene, SceneNode, TextNode } from './scene';

/** A single-color text run rendered to pixels: `alpha` is width x height coverage (0-255). */
export interface RasterText {
  /** Pixel size of the bitmap. */
  pixelWidth: number;
  pixelHeight: number;
  alpha: Uint8Array;
  /** Box in scene units, relative to the text's anchor point on the baseline. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfOptions {
  paper: Paper;
  /** Page margin in points (default 36 = 0.5 in). */
  margin?: number;
  /** Creation date written to the document info (default now). */
  date?: Date;
  rasterizeText?: (node: TextNode) => Promise<RasterText | null>;
  /** zlib (FlateDecode) compressor; streams are left uncompressed without one. */
  deflate?: (data: Uint8Array) => Promise<Uint8Array>;
}

/** Portrait or landscape: whichever lets the drawing be printed larger. */
export const pageFor = (scene: Pick<Scene, 'width' | 'height'>, paper: Paper, margin = 36) => {
  const { width: pw, height: ph } = PAPER_SIZES[paper];
  const fit = (w: number, h: number) =>
    Math.min((w - 2 * margin) / scene.width, (h - 2 * margin) / scene.height);
  const portrait = fit(pw, ph);
  const landscape = fit(ph, pw);
  return landscape > portrait
    ? { width: ph, height: pw, scale: landscape, landscape: true }
    : { width: pw, height: ph, scale: portrait, landscape: false };
};

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const rgb = (hex: string): [number, number, number] => {
  const c = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Number.isNaN(v) ? 0 : v / 255;
  };
  return [c(1), c(3), c(5)];
};

const color = (hex: string, op: 'rg' | 'RG') =>
  `${rgb(hex)
    .map((v) => num(v))
    .join(' ')} ${op}`;

/** A PDF literal string in WinAnsiEncoding, ASCII-only (others as octal escapes). */
const pdfString = (text: string): string => {
  let out = '(';
  for (const ch of text) {
    const b = winAnsiByte(ch) ?? 0x3f; // '?'
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
};

/** A PDF text string for the document info dictionary (UTF-16BE, hex). */
const pdfTextString = (text: string): string => {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
};

const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
};

/** `cm` operator for a clockwise rotation about (cx, cy) in the (y-down) scene space. */
const rotationCm = ({ deg, cx, cy }: Rotation) => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const e = cx - cx * cos + cy * sin;
  const f = cy - cx * sin - cy * cos;
  return `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(e)} ${num(f)} cm`;
};

const pathOps = (d: PathCommand[]) =>
  d
    .map((c) => {
      switch (c[0]) {
        case 'M':
          return `${num(c[1])} ${num(c[2])} m`;
        case 'L':
          return `${num(c[1])} ${num(c[2])} l`;
        case 'C':
          return `${c
            .slice(1)
            .map((v) => num(v as number))
            .join(' ')} c`;
        case 'Z':
          return 'h';
      }
    })
    .join('\n');

const roundedRect = (x: number, y: number, w: number, h: number, r: number): PathCommand[] => {
  if (!r) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const k = r * (1 - 0.5522847498);
  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['C', x + w - k, y, x + w, y + k, x + w, y + r],
    ['L', x + w, y + h - r],
    ['C', x + w, y + h - k, x + w - k, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['C', x + k, y + h, x, y + h - k, x, y + h - r],
    ['L', x, y + r],
    ['C', x, y + k, x + k, y, x + r, y],
    ['Z'],
  ];
};

interface ImageXObject {
  name: string;
  raster: RasterText;
  color: string;
}

const textAnchorOffset = (node: TextNode, width: number) =>
  node.anchor === 'middle' ? -width / 2 : node.anchor === 'end' ? -width : 0;

/** Content-stream operators for the scene (in scene units; the caller sets up the page transform). */
const contentFor = async (
  nodes: SceneNode[],
  images: ImageXObject[],
  rasterize: PdfOptions['rasterizeText'],
): Promise<string> => {
  const out: string[] = [];
  const walk = async (node: SceneNode): Promise<void> => {
    if (node.kind === 'group') {
      for (const child of node.children) await walk(child);
      return;
    }
    out.push('q');
    if (node.rotate) out.push(rotationCm(node.rotate));
    if (node.kind === 'text') {
      if (!isWinAnsi(node.text) && rasterize) {
        const raster = await rasterize(node);
        if (raster) {
          const name = `Im${images.length + 1}`;
          images.push({ name, raster, color: node.fill });
          // Unit square -> image box; the bitmap's first row is its top.
          const x = node.x + raster.left;
          const y = node.y + raster.top;
          out.push(
            `${num(raster.width)} 0 0 ${num(-raster.height)} ${num(x)} ${num(y + raster.height)} cm`,
          );
          out.push(`/${name} Do`, 'Q');
          return;
        }
      }
      const width = measureText(node.text, node.size, node.bold);
      const x = node.x + textAnchorOffset(node, width);
      out.push(
        color(node.fill, 'rg'),
        'BT',
        `/${node.bold ? 'F2' : 'F1'} ${num(node.size)} Tf`,
        // Text space is y-up; flip it back inside the y-down page transform.
        `1 0 0 -1 ${num(x)} ${num(node.y)} Tm`,
        `${pdfString(node.text)} Tj`,
        'ET',
        'Q',
      );
      return;
    }
    const d =
      node.kind === 'rect' ? roundedRect(node.x, node.y, node.w, node.h, node.rx ?? 0) : node.d;
    out.push(pathOps(d));
    const fill = node.fill && node.fill !== 'none';
    const stroke = !!node.stroke;
    if (fill) out.push(color(node.fill!, 'rg'));
    if (stroke) {
      out.push(color(node.stroke!, 'RG'), `${num(node.strokeWidth ?? 1)} w`, '1 J 1 j');
      if (node.dash?.length) out.push(`[${node.dash.map(num).join(' ')}] 0 d`);
    }
    out.push(fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n', 'Q');
  };
  for (const node of nodes) await walk(node);
  return out.join('\n');
};

const ascii = (s: string) => new TextEncoder().encode(s);

/** Render the plan scene as a one-page PDF. */
export const scenePdf = async (scene: Scene, options: PdfOptions): Promise<Uint8Array> => {
  const margin = options.margin ?? 36;
  const page = pageFor(scene, options.paper, margin);
  const images: ImageXObject[] = [];
  const body = await contentFor(scene.nodes, images, options.rasterizeText);

  // Center the drawing; flip to the scene's y-down coordinates.
  const ox = (page.width - scene.width * page.scale) / 2;
  const oy = (page.height - scene.height * page.scale) / 2;
  const content = [
    'q',
    `${num(page.scale)} 0 0 ${num(-page.scale)} ${num(ox)} ${num(page.height - oy)} cm`,
    color(scene.background, 'rg'),
    `0 0 ${num(scene.width)} ${num(scene.height)} re f`,
    body,
    'Q',
  ].join('\n');

  // Objects: 1 catalog, 2 pages, 3 page, 4 content, 5-6 fonts, 7 info, then images (+ masks).
  const objects: (Uint8Array | string)[][] = [];
  const add = (...parts: (Uint8Array | string)[]) => {
    objects.push(parts);
    return objects.length;
  };
  const stream = async (dict: string, data: Uint8Array) => {
    const packed = options.deflate ? await options.deflate(data) : data;
    const filter = options.deflate ? ' /Filter /FlateDecode' : '';
    return [`<< ${dict}${filter} /Length ${packed.length} >>\nstream\n`, packed, '\nendstream'];
  };

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const pageIndex = objects.length; // filled in once image object numbers are known
  add('');
  add(...(await stream('', ascii(content))));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(
    `<< /Title ${pdfTextString(scene.title)} /Producer (Room Planner) /Creator (room-planner.andrechek.com) /CreationDate ${pdfDate(options.date ?? new Date())} >>`,
  );

  const xobjects: string[] = [];
  for (const img of images) {
    const { pixelWidth: w, pixelHeight: h, alpha } = img.raster;
    const [r, g, b] = rgb(img.color).map((v) => Math.round(v * 255));
    const pixels = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      pixels[i * 3] = r!;
      pixels[i * 3 + 1] = g!;
      pixels[i * 3 + 2] = b!;
    }
    const base = `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /BitsPerComponent 8`;
    const mask = add(...(await stream(`${base} /ColorSpace /DeviceGray`, alpha)));
    const image = add(
      ...(await stream(`${base} /ColorSpace /DeviceRGB /SMask ${mask} 0 R`, pixels)),
    );
    xobjects.push(`/${img.name} ${image} 0 R`);
  }
  objects[pageIndex] = [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : ''} >> ` +
      '/Contents 4 0 R >>',
  ];

  // Serialize with a cross-reference table of byte offsets.
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary-content marker comment
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n`);
    for (const part of parts) push(part);
    push('\nendobj\n');
  });
  const xref = offset;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const pdf = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    pdf.set(c, at);
    at += c.length;
  }
  return pdf;
};

/** zlib-deflate with the platform's CompressionStream (browsers, Node >= 18). */
export const deflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const compressed = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
};
