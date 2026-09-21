import * as THREE from 'three';

export interface DialArc {
  from: number;
  to: number;
  color: string;
  /** Radial position of the arc, as a fraction of the face radius. */
  radius?: number;
  width?: number;
}

export interface DialSpec {
  min: number;
  max: number;
  /** Needle angle at `min` and at `max`, radians clockwise from 12 o'clock. */
  startAngle: number;
  endAngle: number;
  /** Value step between numbered ticks. */
  majorStep: number;
  /** Value step between unnumbered ticks. */
  minorStep?: number;
  /** Formats a major tick's number. Defaults to the raw value. */
  labelFormat?: (value: number) => string;
  arcs?: readonly DialArc[];
  /** Instrument name across the face, e.g. "OIL PRESS". */
  title?: string;
  /** Units line under the title, e.g. "PSI". */
  unit?: string;
  /** Extra text drawn low on the face, e.g. "HUNDREDS". */
  subtitle?: string;
  faceColor?: string;
}

const RES = 512;

/** Canvas angle for a dial angle measured clockwise from 12 o'clock. */
function canvasAngle(dialAngle: number): number {
  return dialAngle - Math.PI / 2;
}

export function valueToAngle(spec: DialSpec, value: number): number {
  const t = (value - spec.min) / (spec.max - spec.min);
  return spec.startAngle + THREE.MathUtils.clamp(t, -0.04, 1.04) * (spec.endAngle - spec.startAngle);
}

/**
 * Draws a complete instrument face once, into a canvas texture.
 *
 * Faces never change, so this runs at construction and the per-frame cost of
 * an instrument is just a needle rotation. That is what keeps a panel full
 * of gauges essentially free.
 */
export function drawDialFace(spec: DialSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = RES;
  canvas.height = RES;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const c = RES / 2;
  const r = RES / 2 - 6;

  ctx.fillStyle = spec.faceColor ?? '#0e0f11';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  // Coloured operating-range arcs sit just inside the tick ring.
  for (const arc of spec.arcs ?? []) {
    const ar = r * (arc.radius ?? 0.87);
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = (arc.width ?? 0.075) * r;
    ctx.beginPath();
    ctx.arc(
      c,
      c,
      ar,
      canvasAngle(valueToAngle(spec, arc.from)),
      canvasAngle(valueToAngle(spec, arc.to)),
    );
    ctx.stroke();
  }

  // Minor ticks.
  const minor = spec.minorStep;
  if (minor) {
    ctx.strokeStyle = '#c9ccd1';
    ctx.lineWidth = r * 0.014;
    for (let v = spec.min; v <= spec.max + 1e-9; v += minor) {
      const a = canvasAngle(valueToAngle(spec, v));
      line(ctx, c, a, r * 0.76, r * 0.83);
    }
  }

  // Major ticks and their numbers.
  ctx.strokeStyle = '#f0f2f4';
  ctx.fillStyle = '#f0f2f4';
  ctx.lineWidth = r * 0.026;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.155)}px ui-sans-serif, system-ui, sans-serif`;

  const format = spec.labelFormat ?? ((v: number) => String(Math.round(v)));
  for (let v = spec.min; v <= spec.max + 1e-9; v += spec.majorStep) {
    const a = canvasAngle(valueToAngle(spec, v));
    line(ctx, c, a, r * 0.70, r * 0.83);
    const lr = r * 0.56;
    ctx.fillText(format(v), c + Math.cos(a) * lr, c + Math.sin(a) * lr);
  }

  if (spec.title) {
    ctx.fillStyle = '#d3d6da';
    ctx.font = `600 ${Math.round(r * 0.125)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(spec.title, c, c - r * 0.34);
  }
  if (spec.unit) {
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `600 ${Math.round(r * 0.1)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(spec.unit, c, c - r * 0.2);
  }
  if (spec.subtitle) {
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `600 ${Math.round(r * 0.095)}px ui-sans-serif, system-ui, sans-serif`;
    // Kept close in to the hub: out at label radius it collides with the
    // numbers on dials whose scale wraps past the bottom of the face.
    ctx.fillText(spec.subtitle, c, c + r * 0.30);
  }

  return toTexture(canvas);
}

/** Draws a radial line from `from` to `to`, both as pixel radii. */
function line(
  ctx: CanvasRenderingContext2D,
  centre: number,
  angle: number,
  from: number,
  to: number,
): void {
  ctx.beginPath();
  ctx.moveTo(centre + Math.cos(angle) * from, centre + Math.sin(angle) * from);
  ctx.lineTo(centre + Math.cos(angle) * to, centre + Math.sin(angle) * to);
  ctx.stroke();
}

/** Shared canvas plumbing for the hand-drawn faces (AI, DG, TC, cluster). */
export function customFace(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = RES,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  draw(ctx, size);
  return toTexture(canvas);
}

export function customPlate(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  draw(ctx, width, height);
  return toTexture(canvas);
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
