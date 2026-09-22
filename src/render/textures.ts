import * as THREE from 'three';
import { markPooled } from './geometry';

/**
 * Procedural surface textures.
 *
 * Everything here is generated into a canvas at start-up: albedo, roughness
 * and normal maps for the panel vinyl, the seat fabric, the carpet, painted
 * aluminium and the ramp. Flat untinted colour is the single biggest thing
 * that makes a real-time cockpit read as a toy — a surface with grain, wear
 * and varying roughness catches light the way the real material does.
 */

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

/**
 * Deterministic 32-bit hash, so a reload always produces the same cockpit.
 * Uses Math.imul throughout to keep the multiplies inside 32 bits.
 */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise, tiling over `period` cells so the texture wraps seamlessly. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number) => ((v % period) + period) % period;

  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const y0 = wrap(yi);
  const y1 = wrap(yi + 1);

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export interface FbmOptions {
  /** Cells across the texture at the lowest octave. */
  frequency: number;
  octaves: number;
  /** Amplitude fall-off per octave. */
  gain?: number;
  seed?: number;
}

/** Fractal value noise in 0..1, tiling across the unit square. */
export function fbm(u: number, v: number, opts: FbmOptions): number {
  const gain = opts.gain ?? 0.5;
  const seed = opts.seed ?? 1;
  let amplitude = 1;
  let total = 0;
  let norm = 0;
  let freq = opts.frequency;

  for (let o = 0; o < opts.octaves; o++) {
    total += valueNoise(u * freq, v * freq, freq, seed + o * 17) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= 2;
  }
  return total / norm;
}

/* ------------------------------------------------------------------ */
/* Canvas plumbing                                                     */
/* ------------------------------------------------------------------ */

type PixelShader = (u: number, v: number) => [number, number, number];

function renderCanvas(size: number, shade: PixelShader): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(x / size, y / size);
      const i = (y * size + x) * 4;
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function toTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  repeat: number,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Derives a tangent-space normal map from a height field, by central
 * differences. Cheaper and far more controllable than hand-authoring one.
 */
function normalFromHeight(
  size: number,
  height: (u: number, v: number) => number,
  strength: number,
): HTMLCanvasElement {
  const step = 1 / size;
  return renderCanvas(size, (u, v) => {
    const hL = height(u - step, v);
    const hR = height(u + step, v);
    const hD = height(u, v - step);
    const hU = height(u, v + step);
    const nx = (hL - hR) * strength;
    const ny = (hD - hU) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [nx / len / 2 + 0.5, ny / len / 2 + 0.5, nz / len / 2 + 0.5];
  });
}

export interface SurfaceMaps {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

export interface SurfaceSpec {
  size?: number;
  repeat?: number;
  /** Base colour, as linear-ish 0..1 RGB. */
  color: [number, number, number];
  /** How much the noise darkens and lightens the base colour. */
  colorVariation: number;
  /** Roughness at noise 0 and at noise 1. */
  roughness: [number, number];
  /** Bump height field, in the same 0..1 space as the colour noise. */
  height: (u: number, v: number) => number;
  /** Colour/roughness field. Defaults to the height field. */
  detail?: (u: number, v: number) => number;
  normalStrength: number;
}

/** Builds a matching albedo / roughness / normal set from one noise field. */
export function buildSurface(spec: SurfaceSpec): SurfaceMaps {
  const size = spec.size ?? 512;
  const repeat = spec.repeat ?? 1;
  const detail = spec.detail ?? spec.height;
  const [r, g, b] = spec.color;

  const map = renderCanvas(size, (u, v) => {
    const n = (detail(u, v) - 0.5) * spec.colorVariation;
    return [
      Math.min(1, Math.max(0, r + n)),
      Math.min(1, Math.max(0, g + n)),
      Math.min(1, Math.max(0, b + n)),
    ];
  });

  const [roughLow, roughHigh] = spec.roughness;
  const roughness = renderCanvas(size, (u, v) => {
    const n = detail(u, v);
    const value = roughLow + (roughHigh - roughLow) * n;
    return [value, value, value];
  });

  const normal = normalFromHeight(size, spec.height, spec.normalStrength);

  return {
    map: toTexture(map, THREE.SRGBColorSpace, repeat),
    roughnessMap: toTexture(roughness, THREE.NoColorSpace, repeat),
    normalMap: toTexture(normal, THREE.NoColorSpace, repeat),
  };
}

/* ------------------------------------------------------------------ */
/* Named surfaces                                                      */
/* ------------------------------------------------------------------ */

const cache = new Map<string, SurfaceMaps>();

function surface(key: string, build: () => SurfaceMaps): SurfaceMaps {
  let hit = cache.get(key);
  if (!hit) {
    hit = build();
    // Shared by every material that asks for this surface, so it outlives
    // any one of them and is freed here — by `disposeTextures` — rather than
    // by whichever mesh happens to be torn down first.
    for (const map of Object.values(hit)) markPooled(map);
    cache.set(key, hit);
  }
  return hit;
}

/** Textured vinyl, as used on a Cessna instrument panel: fine pebbled grain. */
export function panelVinyl(): SurfaceMaps {
  return surface('panelVinyl', () =>
    buildSurface({
      size: 512,
      repeat: 3,
      // Charcoal grey, not black. A 172 panel is dark, but at 0.062 linear it
      // read as a flat black hole in the middle of the cabin: the pebbled
      // vinyl texture and the shading around the instrument cutouts were both
      // invisible, because there was no headroom below it for shadow.
      color: [0.125, 0.126, 0.133],
      colorVariation: 0.045,
      roughness: [0.72, 0.96],
      normalStrength: 2.4,
      height: (u, v) => fbm(u, v, { frequency: 96, octaves: 3, gain: 0.55, seed: 3 }),
    }),
  );
}

/** Woven seat cloth: a directional weave over a broader colour mottle. */
export function seatFabric(): SurfaceMaps {
  const weave = (u: number, v: number) => {
    const warp = Math.sin(u * Math.PI * 2 * 128) * 0.5 + 0.5;
    const weft = Math.sin(v * Math.PI * 2 * 128) * 0.5 + 0.5;
    return warp * 0.5 + weft * 0.5;
  };
  return surface('seatFabric', () =>
    buildSurface({
      size: 512,
      repeat: 2,
      color: [0.70, 0.655, 0.552],
      colorVariation: 0.055,
      roughness: [0.62, 0.86],
      normalStrength: 1.6,
      height: (u, v) =>
        weave(u, v) * 0.6 + fbm(u, v, { frequency: 24, octaves: 3, seed: 11 }) * 0.4,
      detail: (u, v) => fbm(u, v, { frequency: 16, octaves: 4, seed: 11 }),
    }),
  );
}

/** Loop-pile carpet: coarse, matte, no specular to speak of. */
export function carpetPile(): SurfaceMaps {
  return surface('carpetPile', () =>
    buildSurface({
      size: 512,
      repeat: 5,
      color: [0.60, 0.548, 0.435],
      colorVariation: 0.07,
      roughness: [0.94, 1.0],
      normalStrength: 2.8,
      height: (u, v) => fbm(u, v, { frequency: 140, octaves: 2, gain: 0.6, seed: 23 }),
      detail: (u, v) => fbm(u, v, { frequency: 40, octaves: 3, seed: 23 }),
    }),
  );
}

/** Moulded interior plastic: a soft leather-grain pattern. */
export function interiorTrim(): SurfaceMaps {
  return surface('interiorTrim', () =>
    buildSurface({
      size: 512,
      repeat: 2,
      color: [0.73, 0.675, 0.565],
      colorVariation: 0.045,
      roughness: [0.7, 0.95],
      normalStrength: 2.0,
      height: (u, v) => fbm(u, v, { frequency: 64, octaves: 4, gain: 0.5, seed: 31 }),
    }),
  );
}

/** Painted aluminium skin, with faint panel-lap waviness. */
export function paintedSkin(): SurfaceMaps {
  return surface('paintedSkin', () =>
    buildSurface({
      size: 512,
      repeat: 1,
      color: [0.82, 0.825, 0.83],
      colorVariation: 0.035,
      roughness: [0.22, 0.42],
      normalStrength: 0.9,
      height: (u, v) => fbm(u, v, { frequency: 18, octaves: 4, seed: 47 }),
    }),
  );
}

/** Weathered asphalt with aggregate and a little staining. */
export function asphaltSurface(): SurfaceMaps {
  return surface('asphaltSurface', () =>
    buildSurface({
      size: 512,
      repeat: 26,
      // Weathered, sun-bleached apron asphalt rather than fresh blacktop.
      // Fresh-laid values read as near-black at this exposure and turn the
      // whole airfield into a void.
      color: [0.168, 0.168, 0.163],
      colorVariation: 0.11,
      roughness: [0.88, 1.0],
      // Asphalt aggregate is millimetre-scale. At a 26× repeat over a whole
      // apron each texel covers centimetres, so a strong normal map turns
      // into visible ripples and the pavement reads as water at grazing
      // angles. Keep the relief slight and let the albedo do the work.
      normalStrength: 0.8,
      height: (u, v) => fbm(u, v, { frequency: 80, octaves: 4, gain: 0.55, seed: 59 }),
      detail: (u, v) =>
        fbm(u, v, { frequency: 80, octaves: 4, gain: 0.55, seed: 59 }) * 0.7 +
        fbm(u, v, { frequency: 6, octaves: 3, seed: 61 }) * 0.3,
    }),
  );
}

/** Mown airfield grass, seen from a long way off most of the time. */
export function grassSurface(): SurfaceMaps {
  return surface('grassSurface', () =>
    buildSurface({
      size: 512,
      repeat: 90,
      color: [0.185, 0.262, 0.105],
      colorVariation: 0.14,
      roughness: [0.85, 1.0],
      normalStrength: 1.4,
      height: (u, v) => fbm(u, v, { frequency: 60, octaves: 3, seed: 71 }),
      detail: (u, v) =>
        fbm(u, v, { frequency: 60, octaves: 3, seed: 71 }) * 0.6 +
        fbm(u, v, { frequency: 5, octaves: 3, seed: 73 }) * 0.4,
    }),
  );
}

/** Brushed and anodised metal for bezels, frames and fittings. */
export function brushedMetal(): SurfaceMaps {
  return surface('brushedMetal', () =>
    buildSurface({
      size: 512,
      repeat: 1,
      color: [0.09, 0.093, 0.1],
      colorVariation: 0.03,
      roughness: [0.28, 0.52],
      normalStrength: 0.7,
      // Brushing runs one way, so the noise is stretched along u.
      height: (u, v) => fbm(u * 0.08, v, { frequency: 200, octaves: 2, seed: 83 }),
    }),
  );
}

export function disposeTextures(): void {
  for (const maps of cache.values()) {
    maps.map.dispose();
    maps.roughnessMap.dispose();
    maps.normalMap.dispose();
  }
  cache.clear();
}
