/**
 * Just enough PDF to print a checklist.
 *
 * Nothing in this project is downloaded — the cockpit, the textures, the
 * instrument faces and the engine note are all generated at runtime — and a
 * PDF library would be the first exception. It does not have to be: the
 * fourteen standard fonts are built into every reader, so a document that
 * sticks to Helvetica needs no font embedded, no glyph outlines and no
 * subsetting, which is the part of writing a PDF that is genuinely hard.
 * What is left is an object table and a page of drawing operators.
 *
 * The file is assembled as a string and converted to bytes at the very end.
 * Every character it contains encodes to exactly one byte in WinAnsi, so a
 * string index is a byte offset, and the cross-reference table — the part a
 * reader refuses the file over — can be built by reading `length` as the
 * objects go in.
 *
 * Coordinates here are top-left origin, y downwards, because that is how the
 * page is laid out in `kid/checklistSheet.ts`. PDF's own axis points the
 * other way; the flip happens at the edge of this class.
 */

/** A4 in points, which is the only page size anything here asks for. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export type PdfFont = 'regular' | 'bold' | 'oblique';

/** How a path is painted. With neither fill nor stroke, nothing is drawn. */
export interface ShapeStyle {
  fill?: readonly [number, number, number];
  stroke?: readonly [number, number, number];
  lineWidth?: number;
}

export interface TextOptions {
  font?: PdfFont;
  size?: number;
  /** Red, green and blue, each 0..1. Defaults to black. */
  colour?: readonly [number, number, number];
}

const FONT_RESOURCE: Record<PdfFont, string> = {
  regular: '/F1',
  bold: '/F2',
  oblique: '/F3',
};

export class PdfDocument {
  /** One list of drawing operators per page. */
  private readonly streams: string[][] = [];

  constructor(
    readonly width = A4.width,
    readonly height = A4.height,
  ) {}

  addPage(): void {
    this.streams.push([]);
  }

  get pageCount(): number {
    return this.streams.length;
  }

  /**
   * Draws a single line of text with its *baseline* at `y`.
   */
  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const stream = this.stream();
    const size = options.size ?? 10;
    const font = FONT_RESOURCE[options.font ?? 'regular'];
    stream.push('BT');
    stream.push(`${font} ${num(size)} Tf`);
    stream.push(colour(options.colour, 'rg'));
    stream.push(`${num(x)} ${num(this.flip(y))} Td`);
    stream.push(`(${escape(value)}) Tj`);
    stream.push('ET');
  }

  /** A rectangle, outlined or filled, from its top-left corner. */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    options: { stroke?: readonly [number, number, number]; fill?: readonly [number, number, number]; lineWidth?: number } = {},
  ): void {
    const stream = this.stream();
    if (options.fill) stream.push(colour(options.fill, 'rg'));
    if (options.stroke) stream.push(colour(options.stroke, 'RG'));
    stream.push(`${num(options.lineWidth ?? 1)} w`);
    stream.push(`${num(x)} ${num(this.flip(y + h))} ${num(w)} ${num(h)} re`);
    stream.push(options.fill && options.stroke ? 'B' : options.fill ? 'f' : 'S');
  }

  /**
   * A circle, as the four cubic beziers everyone approximates one with.
   * PDF has no arc operator; this is the standard 0.5523 control offset.
   */
  circle(cx: number, cy: number, r: number, style: ShapeStyle = {}): void {
    const k = r * 0.5523;
    const stream = this.stream();
    this.begin(stream, style);
    stream.push(`${num(cx)} ${num(this.flip(cy - r))} m`);
    this.curve(stream, cx + k, cy - r, cx + r, cy - k, cx + r, cy);
    this.curve(stream, cx + r, cy + k, cx + k, cy + r, cx, cy + r);
    this.curve(stream, cx - k, cy + r, cx - r, cy + k, cx - r, cy);
    this.curve(stream, cx - r, cy - k, cx - k, cy - r, cx, cy - r);
    stream.push(`h ${paintOp(style)}`);
  }

  /** A rectangle with rounded corners, from its top-left. */
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    style: ShapeStyle = {},
  ): void {
    const radius = Math.min(r, w / 2, h / 2);
    const k = radius * 0.5523;
    const stream = this.stream();
    const [x0, y0, x1, y1] = [x, y, x + w, y + h];
    this.begin(stream, style);
    stream.push(`${num(x0 + radius)} ${num(this.flip(y0))} m`);
    stream.push(`${num(x1 - radius)} ${num(this.flip(y0))} l`);
    this.curve(stream, x1 - radius + k, y0, x1, y0 + radius - k, x1, y0 + radius);
    stream.push(`${num(x1)} ${num(this.flip(y1 - radius))} l`);
    this.curve(stream, x1, y1 - radius + k, x1 - radius + k, y1, x1 - radius, y1);
    stream.push(`${num(x0 + radius)} ${num(this.flip(y1))} l`);
    this.curve(stream, x0 + radius - k, y1, x0, y1 - radius + k, x0, y1 - radius);
    stream.push(`${num(x0)} ${num(this.flip(y0 + radius))} l`);
    this.curve(stream, x0, y0 + radius - k, x0 + radius - k, y0, x0 + radius, y0);
    stream.push(`h ${paintOp(style)}`);
  }

  /** A closed shape through the given points. */
  polygon(points: readonly (readonly [number, number])[], style: ShapeStyle = {}): void {
    this.trace(points, style, true);
  }

  /** An open run of connected segments. */
  polyline(points: readonly (readonly [number, number])[], style: ShapeStyle = {}): void {
    this.trace(points, style, false);
  }

  private trace(
    points: readonly (readonly [number, number])[],
    style: ShapeStyle,
    close: boolean,
  ): void {
    const [first, ...rest] = points;
    if (!first) return;
    const stream = this.stream();
    this.begin(stream, style);
    stream.push(`${num(first[0])} ${num(this.flip(first[1]))} m`);
    for (const [x, y] of rest) stream.push(`${num(x)} ${num(this.flip(y))} l`);
    stream.push(`${close ? 'h ' : ''}${paintOp(style)}`);
  }

  private curve(
    stream: string[],
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void {
    stream.push(
      `${num(x1)} ${num(this.flip(y1))} ${num(x2)} ${num(this.flip(y2))} ` +
        `${num(x3)} ${num(this.flip(y3))} c`,
    );
  }

  /** Colour, width and joins, before any path is laid down. */
  private begin(stream: string[], style: ShapeStyle): void {
    if (style.fill) stream.push(colour(style.fill, 'rg'));
    if (style.stroke) stream.push(colour(style.stroke, 'RG'));
    stream.push(`${num(style.lineWidth ?? 1)} w`);
    // Round caps and joins throughout: at icon size a mitre reads as a burr.
    stream.push('1 J 1 j');
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: { colour?: readonly [number, number, number]; lineWidth?: number } = {},
  ): void {
    const stream = this.stream();
    stream.push(colour(options.colour, 'RG'));
    stream.push(`${num(options.lineWidth ?? 1)} w`);
    stream.push(`${num(x1)} ${num(this.flip(y1))} m ${num(x2)} ${num(this.flip(y2))} l S`);
  }

  /** Width of a string if it were drawn, in points. */
  widthOf(value: string, size: number, font: PdfFont = 'regular'): number {
    const bold = font === 'bold';
    const table = bold ? BOLD : REGULAR;
    let mils = 0;
    for (const char of value) {
      const punctuation = PUNCTUATION_WIDTH[char];
      mils += punctuation ? punctuation[bold ? 1 : 0] : (table[widthIndex(char)] ?? 556);
    }
    return (mils * size) / 1000;
  }

  /**
   * Greedy word wrap. Words longer than the column are left to overhang
   * rather than broken: there are none in this document, and a hyphenation
   * rule invented for nothing is a rule that will be wrong later.
   */
  wrap(value: string, size: number, font: PdfFont, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && this.widthOf(candidate, size, font) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** The finished file. */
  toBytes(): Uint8Array<ArrayBuffer> {
    const objects: string[] = [];
    const pageIds: number[] = [];
    // 1 catalogue, 2 page tree, 3..5 fonts, then a content stream and a page
    // object per page.
    const firstPageId = 6;
    for (let i = 0; i < this.streams.length; i++) {
      pageIds.push(firstPageId + i * 2 + 1);
    }

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    objects[3] = font('Helvetica');
    objects[4] = font('Helvetica-Bold');
    objects[5] = font('Helvetica-Oblique');

    this.streams.forEach((stream, i) => {
      const body = stream.join('\n');
      const contentId = firstPageId + i * 2;
      objects[contentId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
      objects[pageIds[i] as number] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    });

    let file = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = file.length;
      file += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefAt = file.length;
    const count = objects.length; // object 0 is the free-list head
    file += `xref\n0 ${count}\n`;
    file += '0000000000 65535 f \n';
    for (let id = 1; id < objects.length; id++) {
      file += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    file += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

    // Backed by an explicit ArrayBuffer so the result is a `BlobPart`: a
    // plain `new Uint8Array(n)` is typed over `ArrayBufferLike`, which could
    // be shared memory and so is not one.
    const bytes = new Uint8Array(new ArrayBuffer(file.length));
    for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i) & 0xff;
    return bytes;
  }

  private stream(): string[] {
    const stream = this.streams[this.streams.length - 1];
    if (!stream) throw new Error('Nothing to draw on: call addPage() first');
    return stream;
  }

  /** Top-left origin in, PDF's bottom-left origin out. */
  private flip(y: number): number {
    return this.height - y;
  }
}

function paintOp(style: ShapeStyle): string {
  if (style.fill && style.stroke) return 'B';
  if (style.fill) return 'f';
  if (style.stroke) return 'S';
  return 'n';
}

function font(baseFont: string): string {
  // WinAnsiEncoding is what makes å, ä and ö come out as themselves.
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`;
}

function colour(rgb: readonly [number, number, number] | undefined, operator: string): string {
  const [r, g, b] = rgb ?? [0, 0, 0];
  return `${num(r)} ${num(g)} ${num(b)} ${operator}`;
}

/** Three decimals is well under a printer's resolution and keeps files small. */
function num(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

function escape(value: string): string {
  let out = '';
  for (const char of value) {
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`;
    else if (char.charCodeAt(0) <= 255) out += char;
    else {
      const byte = CP1252[char];
      out += byte === undefined ? '?' : String.fromCharCode(byte);
    }
  }
  return out;
}

/**
 * The upper half of WinAnsi that is not Latin-1.
 *
 * The em dash matters: the POH callouts are full of them ("SEATS — ADJUSTED
 * AND LOCKED") and so is the Swedish, and a dash that silently became a
 * question mark is the kind of thing nobody notices until it is printed.
 */
const CP1252: Record<string, number> = {
  '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85,
  '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8a,
  '\u2039': 0x8b, '\u0152': 0x8c, '\u017D': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
  '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203A': 0x9b, '\u0153': 0x9c,
  '\u017E': 0x9e, '\u0178': 0x9f,
};

/* ------------------------------------------------------------------ */
/* Helvetica metrics                                                   */
/* ------------------------------------------------------------------ */

/**
 * Advance widths in 1/1000 em for printable ASCII, from the Adobe font
 * metrics. Needed here rather than in the file: the reader knows these
 * already, but wrapping a line means measuring it first.
 *
 * Helvetica-Oblique has the same widths as Helvetica, which is what lets the
 * reasons be set in italic without a third table.
 */
const REGULAR: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * An accented letter is exactly as wide as the letter underneath it in
 * Helvetica, so the Swedish alphabet needs no entries of its own.
 */
const UNACCENTED: Record<string, string> = {
  å: 'a', ä: 'a', ö: 'o', é: 'e', è: 'e', á: 'a', ü: 'u',
  Å: 'A', Ä: 'A', Ö: 'O', É: 'E', Ü: 'U',
};

/** Widths for the punctuation that lives above Latin-1, regular and bold. */
const PUNCTUATION_WIDTH: Record<string, readonly [number, number]> = {
  '\u2014': [1000, 1000],
  '\u2013': [556, 556],
  '\u2026': [1000, 1000],
  '\u2018': [222, 278],
  '\u2019': [222, 278],
  '\u201C': [333, 500],
  '\u201D': [333, 500],
  '\u2022': [350, 350],
  '\u20AC': [556, 556],
};

function widthIndex(char: string): number {
  const plain = UNACCENTED[char] ?? char;
  return plain.charCodeAt(0) - 32;
}
