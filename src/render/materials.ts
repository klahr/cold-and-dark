import * as THREE from 'three';
import { markPooled } from './geometry';
import {
  asphaltSurface,
  brushedMetal,
  carpetPile,
  grassSurface,
  interiorTrim,
  paintedSkin,
  panelVinyl,
  seatFabric,
  type SurfaceMaps,
} from './textures';

/**
 * Shared material palette.
 *
 * Every surface is procedural — no texture assets — but each one carries an
 * albedo, roughness and normal map generated at start-up. Uniform flat
 * colour is what makes a real-time cockpit look like a diagram; grain and
 * varying roughness is what makes it look like a machine someone has been
 * sitting in for twenty years.
 */

const cache = new Map<string, THREE.Material>();

function std(
  key: string,
  params: THREE.MeshStandardMaterialParameters,
  maps?: SurfaceMaps,
  normalScale = 1,
): THREE.MeshStandardMaterial {
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial(params);
  if (maps) {
    mat.map = maps.map;
    mat.roughnessMap = maps.roughnessMap;
    mat.normalMap = maps.normalMap;
    mat.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  mat.name = key;
  markPooled(mat);
  cache.set(key, mat);
  return mat;
}

export const MAT = {
  /** Instrument panel face: pebbled charcoal vinyl over aluminium. */
  panel: () =>
    std('panel', { color: 0xffffff, roughness: 0.85, metalness: 0.04 }, panelVinyl(), 0.8),

  /** Bezel rings, trim strips and fittings: dark anodised metal. */
  bezel: () =>
    std('bezel', { color: 0xffffff, roughness: 0.42, metalness: 0.72 }, brushedMetal(), 0.5),

  /** Moulded cabin trim, in the warm grey Cessna used. */
  trim: () => std('trim', { color: 0xffffff, roughness: 0.9, metalness: 0.0 }, interiorTrim(), 0.7),

  /** Glareshield: deliberately the flattest, blackest thing in the cabin. */
  glareshield: () =>
    std('glareshield', { color: 0x2e2e30, roughness: 0.99, metalness: 0.0 }, panelVinyl(), 1.5),

  /** Seat upholstery. */
  seat: () => std('seat', { color: 0xffffff, roughness: 0.8, metalness: 0.0 }, seatFabric(), 0.75),

  /** Seat frame, rails and exposed structure. */
  frame: () =>
    std('frame', { color: 0xa8acb2, roughness: 0.38, metalness: 0.88 }, brushedMetal(), 0.35),

  /** Cabin floor carpet. */
  carpet: () =>
    std('carpet', { color: 0xffffff, roughness: 0.98, metalness: 0.0 }, carpetPile(), 1.0),

  /** Yoke and control column: moulded satin black. */
  yoke: () => std('yoke', { color: 0x25272b, roughness: 0.62, metalness: 0.12 }),

  /**
   * Windscreen and side glass.
   *
   * Kept very clear, and with the environment contribution turned right
   * down. A large pane at near-zero roughness under a bright sky picks up
   * so much specular that it reads as a milky sheet across the whole
   * windscreen — which looks exactly like a modelling error even when the
   * geometry behind it is perfectly correct.
   */
  glass: () => {
    const mat = std('glass', {
      color: 0xe6f2f8,
      roughness: 0.06,
      metalness: 0.0,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.envMapIntensity = 0.2;
    return mat;
  },

  /** Instrument cover glass. */
  instrumentGlass: () =>
    std('instrumentGlass', {
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0.0,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    }),

  /** Airfield grass. */
  grass: () =>
    std('grass', { color: 0xffffff, roughness: 0.95, metalness: 0.0 }, grassSurface(), 0.8),

  /** Ramp and runway asphalt. */
  asphalt: () =>
    std('asphalt', { color: 0xffffff, roughness: 0.92, metalness: 0.0 }, asphaltSurface(), 0.9),

  /** Painted markings on the ramp. */
  marking: () => std('marking', { color: 0xc9c9be, roughness: 0.82, metalness: 0.0 }),

  /** Painted aluminium airframe skin. */
  skin: () => std('skin', { color: 0xffffff, roughness: 0.3, metalness: 0.22 }, paintedSkin(), 0.6),

  /** Accent stripe paint on the fuselage and tail. */
  stripe: () => std('stripe', { color: 0x1d4a86, roughness: 0.28, metalness: 0.2 }),

  /** Tyres. */
  rubber: () => std('rubber', { color: 0x141416, roughness: 0.95, metalness: 0.0 }),
} as const;

/**
 * Pick proxy material.
 *
 * The proxies are also set `visible = false`, which removes ~100 draw calls
 * from every frame. three's raycaster walks the objects it is handed
 * without testing visibility, so hidden proxies are still picked — the
 * non-writing material is belt-and-braces in case that ever changes.
 */
let hitMaterial: THREE.MeshBasicMaterial | null = null;
export function hitProxyMaterial(): THREE.MeshBasicMaterial {
  if (!hitMaterial) {
    hitMaterial = new THREE.MeshBasicMaterial();
    hitMaterial.name = 'hitProxy';
    hitMaterial.colorWrite = false;
    hitMaterial.depthWrite = false;
    markPooled(hitMaterial);
  }
  return hitMaterial;
}

/** Control knob colours follow the aviation convention. */
export const KNOB_COLOR = {
  throttle: 0x141414,
  mixture: 0xb51a1a,
  propeller: 0x1f5fbd,
  carbHeat: 0xdedad0,
  primer: 0x9a9a95,
  cabin: 0x9a9a95,
} as const;

export function knobMaterial(color: number): THREE.MeshStandardMaterial {
  return std(`knob-${color.toString(16)}`, {
    color,
    roughness: 0.46,
    metalness: 0.18,
  });
}
