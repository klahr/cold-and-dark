import * as THREE from 'three';

export interface LabelOptions {
  /** World height of one line of text, metres. */
  size?: number;
  color?: string;
  /** Extra letter spacing, as a fraction of the font size. */
  tracking?: number;
  weight?: number;
  align?: 'center' | 'left' | 'right';
  /** Draw a filled plate behind the text. */
  background?: string;
  padding?: number;
}

const PIXELS_PER_METRE = 6000;

/**
 * Panel silkscreen text. Every label is its own small canvas texture; a 172
 * panel needs a few dozen, which is far cheaper than pulling in a font
 * loader and keeps the whole cockpit asset-free.
 */
export function makeLabel(text: string, opts: LabelOptions = {}): THREE.Mesh {
  const size = opts.size ?? 0.006;
  const color = opts.color ?? '#d7d9dc';
  const tracking = opts.tracking ?? 0.12;
  const weight = opts.weight ?? 600;
  const padding = opts.padding ?? 0.35;

  const fontPx = Math.max(16, Math.round(size * PIXELS_PER_METRE));
  const font = `${weight} ${fontPx}px ui-sans-serif, system-ui, sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('2D canvas context unavailable');
  measure.font = font;
  const spacing = fontPx * tracking;
  const textWidth =
    text.split('').reduce((sum, ch) => sum + measure.measureText(ch).width, 0) +
    spacing * Math.max(0, text.length - 1);

  const padPx = Math.round(fontPx * padding);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth) + padPx * 2;
  canvas.height = Math.ceil(fontPx * 1.45) + padPx * 2;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  let x = padPx;
  const y = canvas.height / 2;
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;

  // The canvas was laid out at fontPx per `size` metres, so scale back.
  const heightMetres = (canvas.height / fontPx) * size;
  const widthMetres = (canvas.width / fontPx) * size;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthMetres, heightMetres),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = 2;

  if (opts.align === 'left') mesh.position.x = widthMetres / 2;
  if (opts.align === 'right') mesh.position.x = -widthMetres / 2;

  return mesh;
}
