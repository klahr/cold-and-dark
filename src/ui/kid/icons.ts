import type { PdfDocument, ShapeStyle } from '../pdf/PdfDocument';

/**
 * The step pictures, as vector drawings.
 *
 * The card on screen leads with a picture because at six it is recognised
 * from across the room, well before the sentence under it is read. The sheet
 * had none, and a printed page of nothing but Swedish sentences asks the
 * child to do the reading the screen was careful not to ask for.
 *
 * They are drawn rather than embedded. An emoji in a PDF means carrying a
 * font — a colour emoji font is megabytes, and it would be the first asset
 * this project ever downloaded. Rasterising them off a canvas would have
 * meant a DOM at build time, a blurry glyph at print resolution, and a
 * picture that depends on which emoji font the machine happens to own.
 * Drawn shapes cost nothing, stay sharp at any size, print legibly in black
 * and white, and can be tested without a browser — which is the same bargain
 * the cockpit textures and the instrument faces already make.
 *
 * **Keyed by the emoji they stand in for**, so a step cannot end up with one
 * picture on screen and a different one on paper, and a new step that reuses
 * an existing emoji gets its drawing for nothing.
 */

const INK: readonly [number, number, number] = [0.13, 0.15, 0.2];
const WHITE: readonly [number, number, number] = [1, 1, 1];
const RED: readonly [number, number, number] = [0.85, 0.22, 0.2];
const BLUE: readonly [number, number, number] = [0.2, 0.45, 0.75];
const SKY: readonly [number, number, number] = [0.45, 0.72, 0.92];
const YELLOW: readonly [number, number, number] = [0.97, 0.75, 0.16];
const GREEN: readonly [number, number, number] = [0.3, 0.64, 0.36];
const GREY: readonly [number, number, number] = [0.55, 0.58, 0.63];

/** The soft tile the picture sits on, as on the card. */
const TILE: readonly [number, number, number] = [1, 0.953, 0.812];

/**
 * A drawing surface one unit square, y downwards, which the renderer maps
 * onto wherever the tile actually is. Line widths are in the same units, so
 * an icon scales whole rather than growing spindly as the tile grows.
 */
interface Pen {
  circle(cx: number, cy: number, r: number, style: ShapeStyle): void;
  round(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void;
  poly(points: readonly (readonly [number, number])[], style: ShapeStyle): void;
  stroke(points: readonly (readonly [number, number])[], style: ShapeStyle): void;
  letter(value: string, cx: number, baseline: number, size: number, colour: readonly [number, number, number]): void;
}

type Icon = (pen: Pen) => void;

/* ------------------------------------------------------------------ */
/* The pictures                                                        */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, Icon> = {
  /* Seat, from the side. Back and cushion share one outline: drawn as two
     boxes meeting at a corner it read as a letter L. */
  '\u{1F4BA}': (p) => {
    p.poly(
      [
        [0.2, 0.05],
        [0.44, 0.05],
        [0.44, 0.5],
        [0.82, 0.5],
        [0.82, 0.68],
        [0.2, 0.68],
      ],
      { fill: BLUE, stroke: INK, lineWidth: 0.055 },
    );
    p.round(0.45, 0.68, 0.11, 0.17, 0.03, { fill: GREY, stroke: INK, lineWidth: 0.05 });
    p.round(0.3, 0.83, 0.4, 0.11, 0.05, { fill: GREY, stroke: INK, lineWidth: 0.05 });
  },

  /* Harness: a vest with a sash across it. */
  '\u{1F3BD}': (p) => {
    // The armholes are what make it a vest. Without them the outline is a
    // trapezium, which reads as a tent.
    p.poly(
      [
        [0.18, 0.22],
        [0.36, 0.1],
        [0.44, 0.26],
        [0.56, 0.26],
        [0.64, 0.1],
        [0.82, 0.22],
        [0.71, 0.44],
        [0.76, 0.94],
        [0.24, 0.94],
        [0.29, 0.44],
      ],
      { fill: SKY, stroke: INK, lineWidth: 0.055 },
    );
    p.poly(
      [
        [0.34, 0.16],
        [0.45, 0.22],
        [0.66, 0.94],
        [0.52, 0.94],
      ],
      { fill: RED, stroke: INK, lineWidth: 0.045 },
    );
  },

  /* Door, with a handle. */
  '\u{1F6AA}': (p) => {
    p.round(0.22, 0.06, 0.56, 0.88, 0.06, { fill: WHITE, stroke: INK, lineWidth: 0.07 });
    p.round(0.32, 0.17, 0.36, 0.34, 0.04, { stroke: INK, lineWidth: 0.045 });
    p.circle(0.68, 0.62, 0.055, { fill: INK });
  },

  /* The parking sign. */
  '\u{1F17F}': (p) => {
    p.round(0.06, 0.06, 0.88, 0.88, 0.2, { fill: BLUE });
    p.letter('P', 0.5, 0.76, 0.78, WHITE);
  },

  /* Fuel pump. */
  '⛽': (p) => {
    p.round(0.12, 0.14, 0.46, 0.8, 0.07, { fill: YELLOW, stroke: INK, lineWidth: 0.055 });
    p.round(0.2, 0.24, 0.3, 0.22, 0.03, { fill: WHITE, stroke: INK, lineWidth: 0.045 });
    p.stroke(
      [
        [0.58, 0.4],
        [0.78, 0.4],
        [0.78, 0.74],
      ],
      { stroke: INK, lineWidth: 0.075 },
    );
    p.circle(0.78, 0.8, 0.07, { fill: INK });
  },

  /* Radio set. */
  '\u{1F4FB}': (p) => {
    p.stroke(
      [
        [0.66, 0.34],
        [0.9, 0.08],
      ],
      { stroke: INK, lineWidth: 0.06 },
    );
    p.round(0.06, 0.34, 0.88, 0.58, 0.08, { fill: GREY, stroke: INK, lineWidth: 0.055 });
    p.circle(0.32, 0.63, 0.15, { fill: WHITE, stroke: INK, lineWidth: 0.045 });
    p.circle(0.68, 0.52, 0.06, { fill: INK });
    p.circle(0.68, 0.74, 0.06, { fill: INK });
  },

  /* Circuit breaker: a push button. */
  '\u{1F518}': (p) => {
    p.circle(0.5, 0.5, 0.4, { fill: WHITE, stroke: INK, lineWidth: 0.085 });
    p.circle(0.5, 0.5, 0.17, { fill: INK });
  },

  /* The red knob. */
  '\u{1F534}': (p) => {
    p.circle(0.5, 0.5, 0.4, { fill: RED, stroke: INK, lineWidth: 0.055 });
    p.circle(0.37, 0.36, 0.1, { fill: WHITE });
  },

  /* Snowflake, for cold. */
  '❄': (p) => {
    // Six arms, each with a pair of branches swept outward. Three bare
    // crossed lines with a V top and bottom read as a Bluetooth mark.
    const style: ShapeStyle = { stroke: BLUE, lineWidth: 0.07 };
    const c = 0.5;
    const arm = 0.43;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      p.stroke([[c, c], [c + Math.cos(a) * arm, c + Math.sin(a) * arm]], style);
      const from: readonly [number, number] = [
        c + Math.cos(a) * arm * 0.52,
        c + Math.sin(a) * arm * 0.52,
      ];
      for (const sweep of [0.75, -0.75]) {
        p.stroke(
          [
            from,
            [from[0] + Math.cos(a + sweep) * arm * 0.36, from[1] + Math.sin(a + sweep) * arm * 0.36],
          ],
          style,
        );
      }
    }
  },

  /* Battery, charged. */
  '\u{1F50B}': (p) => {
    p.round(0.82, 0.4, 0.12, 0.2, 0.03, { fill: INK });
    p.round(0.06, 0.26, 0.78, 0.48, 0.07, { fill: WHITE, stroke: INK, lineWidth: 0.07 });
    for (const x of [0.15, 0.36, 0.57]) {
      p.round(x, 0.35, 0.14, 0.3, 0.02, { fill: GREEN });
    }
  },

  /* Rotating beacon, flashing. */
  '\u{1F6A8}': (p) => {
    const ray: ShapeStyle = { stroke: YELLOW, lineWidth: 0.075 };
    p.stroke([[0.5, 0.2], [0.5, 0.05]], ray);
    p.stroke([[0.2, 0.34], [0.08, 0.22]], ray);
    p.stroke([[0.8, 0.34], [0.92, 0.22]], ray);
    p.circle(0.5, 0.6, 0.26, { fill: RED, stroke: INK, lineWidth: 0.055 });
    p.round(0.22, 0.68, 0.56, 0.2, 0.05, { fill: GREY, stroke: INK, lineWidth: 0.055 });
  },

  /* A drop of fuel. */
  '\u{1F4A7}': (p) => {
    p.circle(0.5, 0.62, 0.28, { fill: SKY, stroke: INK, lineWidth: 0.055 });
    p.poly(
      [
        [0.5, 0.08],
        [0.76, 0.6],
        [0.24, 0.6],
      ],
      { fill: SKY, stroke: INK, lineWidth: 0.055 },
    );
    // Drawn again on top, so the seam between the two shapes does not show.
    p.circle(0.5, 0.62, 0.245, { fill: SKY });
  },

  /* Traffic light, for "a little throttle". */
  '\u{1F6A6}': (p) => {
    p.stroke([[0.5, 0.82], [0.5, 0.97]], { stroke: INK, lineWidth: 0.08 });
    p.round(0.27, 0.05, 0.46, 0.78, 0.1, { fill: INK });
    p.circle(0.5, 0.22, 0.1, { fill: RED });
    p.circle(0.5, 0.44, 0.1, { fill: YELLOW });
    p.circle(0.5, 0.66, 0.1, { fill: GREEN });
  },

  /* Two eyes, for the propeller check. */
  '\u{1F440}': (p) => {
    p.circle(0.28, 0.5, 0.23, { fill: WHITE, stroke: INK, lineWidth: 0.06 });
    p.circle(0.72, 0.5, 0.23, { fill: WHITE, stroke: INK, lineWidth: 0.06 });
    p.circle(0.33, 0.5, 0.095, { fill: INK });
    p.circle(0.77, 0.5, 0.095, { fill: INK });
  },

  /* The ignition key. */
  '\u{1F511}': (p) => {
    p.round(0.42, 0.36, 0.16, 0.58, 0.03, { fill: YELLOW, stroke: INK, lineWidth: 0.05 });
    p.round(0.58, 0.58, 0.14, 0.09, 0.02, { fill: YELLOW, stroke: INK, lineWidth: 0.045 });
    p.round(0.58, 0.74, 0.14, 0.09, 0.02, { fill: YELLOW, stroke: INK, lineWidth: 0.045 });
    p.circle(0.5, 0.26, 0.2, { fill: YELLOW, stroke: INK, lineWidth: 0.055 });
    p.circle(0.5, 0.26, 0.07, { fill: WHITE, stroke: INK, lineWidth: 0.04 });
  },

  /* Oil drum. */
  '\u{1F6E2}': (p) => {
    p.round(0.2, 0.08, 0.6, 0.84, 0.1, { fill: [0.35, 0.38, 0.44], stroke: INK, lineWidth: 0.055 });
    p.stroke([[0.22, 0.35], [0.78, 0.35]], { stroke: YELLOW, lineWidth: 0.07 });
    p.stroke([[0.22, 0.65], [0.78, 0.65]], { stroke: YELLOW, lineWidth: 0.07 });
  },

  /* A lever on its track, for setting RPM. */
  '\u{1F39A}': (p) => {
    // A fat knob on a thin track. Matched in weight they made a plus sign.
    for (const x of [0.22, 0.5, 0.78]) {
      p.stroke([[x, 0.2], [x, 0.31]], { stroke: GREY, lineWidth: 0.05 });
    }
    p.round(0.06, 0.46, 0.88, 0.09, 0.045, { fill: GREY, stroke: INK, lineWidth: 0.04 });
    p.round(0.33, 0.34, 0.18, 0.52, 0.06, { fill: BLUE, stroke: INK, lineWidth: 0.055 });
  },

  /* Lightning, for charging. */
  '⚡': (p) => {
    p.poly(
      [
        [0.58, 0.05],
        [0.24, 0.55],
        [0.45, 0.55],
        [0.38, 0.95],
        [0.76, 0.43],
        [0.52, 0.43],
      ],
      { fill: YELLOW, stroke: INK, lineWidth: 0.05 },
    );
  },

  /* The aeroplane, for a step with no picture of its own. */
  '✈': (p) => {
    p.poly(
      [
        [0.5, 0.04],
        [0.58, 0.38],
        [0.94, 0.6],
        [0.94, 0.7],
        [0.58, 0.6],
        [0.56, 0.82],
        [0.68, 0.92],
        [0.68, 0.97],
        [0.5, 0.9],
        [0.32, 0.97],
        [0.32, 0.92],
        [0.44, 0.82],
        [0.42, 0.6],
        [0.06, 0.7],
        [0.06, 0.6],
        [0.42, 0.38],
      ],
      { fill: BLUE, stroke: INK, lineWidth: 0.04 },
    );
  },
};

/**
 * Emoji carry an invisible "yes, really, as a picture" selector that is part
 * of the string but no part of the character. Keying on it would mean every
 * lookup silently missing.
 */
function key(emoji: string): string {
  return emoji.replace(/[︎️]/g, '');
}

/** True when this emoji has a drawing; `tests/checklist-pdf.test.ts` insists. */
export function hasIcon(emoji: string): boolean {
  return key(emoji) in ICONS;
}

/**
 * Draws the tile and its picture, with the top-left corner at `x, y`.
 *
 * An emoji with no drawing gets the tile and nothing on it, which looks
 * deliberate, rather than a missing-glyph box or a hole in the row.
 */
export function drawIcon(
  doc: PdfDocument,
  emoji: string,
  x: number,
  y: number,
  size: number,
): void {
  doc.roundRect(x, y, size, size, size * 0.26, { fill: TILE });

  const icon = ICONS[key(emoji)];
  if (!icon) return;

  // The picture sits inside the tile rather than on its corners.
  const pad = 0.16;
  const inner = size * (1 - pad * 2);
  const ox = x + size * pad;
  const oy = y + size * pad;
  const at = (u: number, v: number): [number, number] => [ox + u * inner, oy + v * inner];
  const scale = (style: ShapeStyle): ShapeStyle =>
    style.lineWidth === undefined ? style : { ...style, lineWidth: style.lineWidth * inner };

  icon({
    circle: (cx, cy, r, style) => doc.circle(ox + cx * inner, oy + cy * inner, r * inner, scale(style)),
    round: (rx, ry, w, h, r, style) =>
      doc.roundRect(ox + rx * inner, oy + ry * inner, w * inner, h * inner, r * inner, scale(style)),
    poly: (points, style) => doc.polygon(points.map(([u, v]) => at(u, v)), scale(style)),
    stroke: (points, style) => doc.polyline(points.map(([u, v]) => at(u, v)), scale(style)),
    letter: (value, cx, baseline, fontSize, colour) => {
      const size2 = fontSize * inner;
      doc.text(value, ox + cx * inner - doc.widthOf(value, size2, 'bold') / 2, oy + baseline * inner, {
        font: 'bold',
        size: size2,
        colour,
      });
    },
  });
}
