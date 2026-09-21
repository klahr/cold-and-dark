import * as THREE from 'three';
import { PANEL } from './frame';

export interface Placard {
  text: string;
  /** Panel-local position, metres. */
  x: number;
  y: number;
  /** Cap height, metres. */
  size: number;
}

/** Pixels per metre of panel. 1.04 m wide at this density is a 2048 canvas. */
const DENSITY = 1970;

/**
 * Every panel placard, printed onto a single sheet.
 *
 * The lettering on a real instrument panel is silkscreened straight onto
 * the panel, not applied as forty separate labels — and doing the same here
 * turns forty-odd draw calls and forty-odd little textures into one of
 * each. It also looks better: the text sits *on* the panel surface instead
 * of floating a fraction of a millimetre in front of it.
 */
export function buildSilkscreen(placards: readonly Placard[]): THREE.Mesh | null {
  if (placards.length === 0) return null;

  const width = Math.round(PANEL.width * DENSITY);
  const height = Math.round(PANEL.height * DENSITY);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const placard of placards) {
    // Panel space has +y up and the origin at the centre; canvas has +y down
    // and the origin at the top left.
    const px = (placard.x + PANEL.width / 2) * DENSITY;
    const py = (PANEL.height / 2 - placard.y) * DENSITY;
    const fontPx = placard.size * DENSITY;

    ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    // A hint of engraved depth: a dark offset under pale lettering.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    drawTracked(ctx, placard.text, px, py + fontPx * 0.08, fontPx * 0.13);
    ctx.fillStyle = '#d5d8dc';
    drawTracked(ctx, placard.text, px, py, fontPx * 0.13);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL.width, PANEL.height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.name = 'panel-silkscreen';
  mesh.position.z = 0.0012;
  mesh.renderOrder = 2;
  return mesh;
}

/** Panel lettering is always widely tracked; canvas has no letter-spacing. */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  spacing: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, text.length - 1);
  let x = cx - total / 2;
  for (const [i, ch] of [...text].entries()) {
    const w = widths[i] ?? 0;
    ctx.fillText(ch, x + w / 2, cy);
    x += w + spacing;
  }
}
