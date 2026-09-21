import * as THREE from 'three';
import { PANEL, PANEL_HALF_H, PANEL_HALF_W } from './frame';
import { cabinHalfWidthAt, LINING_FRONT } from './fuselage';

/**
 * The outline of the instrument panel face.
 *
 * This lives in its own module, apart from the rest of the cockpit builder,
 * for two reasons: the panel outline is what every other piece of panel
 * furniture has to be cut to, and it is cheap enough to import into a test —
 * `tests/panel-fit.test.ts` asserts that every instrument and control in
 * every aircraft definition actually fits inside it.
 *
 * That test exists because of a real bug. The panel was authored as a plain
 * 1.04 m rounded rectangle, but the cabin measures about 0.95 m across at
 * panel height, so the panel's outer corners were buried in the sidewall. The
 * visible symptom was not the panel at all: from the left seat the sightline
 * to the far corner of the six-pack passes *through* the lining, so the
 * pilot's own airspeed indicator was occluded by the fuselage.
 */

/** Clearance kept between the panel edge and the lining surface. */
const WALL_CLEARANCE = 0.012;
/** Radius of the fillet on the top and bottom corners. */
const CORNER = 0.075;

/** World-space (y, z) of a point at height `panelY` up the tilted panel face. */
export function panelPointToWorld(panelY: number): { y: number; z: number } {
  return {
    y: PANEL.center[1] + panelY * Math.cos(PANEL.tiltX),
    z: PANEL.center[2] + panelY * Math.sin(PANEL.tiltX),
  };
}

/**
 * Half-width of the panel at a given height up its face, from whichever of
 * two constraints is tighter:
 *
 *  - **The cabin.** Measured from the hull loft, so the panel narrows toward
 *    the top exactly as the fuselage does and can never again be wider than
 *    the cabin it sits in. Most of the panel is forward of where the lining
 *    starts, but the lining is what does the occluding, so the clearance that
 *    matters is the one at its front rim.
 *  - **A corner fillet.** Following the hull alone only takes about 3 cm off
 *    the top corners — too subtle to read as anything but a mistake. The
 *    fillet gives the panel the rounded outline the real aeroplane has, where
 *    the top corners sweep up into the windscreen.
 */
export function panelHalfWidthAt(panelY: number): number {
  const { y, z } = panelPointToWorld(panelY);
  const hull = cabinHalfWidthAt(Math.max(z, LINING_FRONT), y);
  const cabinLimit = Math.max(0.05, hull - WALL_CLEARANCE);

  const inset = PANEL_HALF_H - Math.abs(panelY);
  const fillet =
    inset >= CORNER
      ? 0
      : CORNER - Math.sqrt(Math.max(0, CORNER * CORNER - (CORNER - inset) ** 2));

  return Math.min(cabinLimit, PANEL_HALF_W) - fillet;
}

/**
 * The panel face outline, as a closed shape in panel-local 2D.
 *
 * `steps` needs to be generous. The fillet only spans 0.075 m of a 0.52 m
 * face, so at 26 steps it gets about four samples and the corner reads as a
 * straight chamfer rather than a curve — which looks like a mistake instead
 * of a detail. The shape is extruded once at start-up, so the extra points
 * cost nothing at runtime.
 */
export function panelOutline(steps = 96): THREE.Shape {
  const right: THREE.Vector2[] = [];
  const left: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = -PANEL_HALF_H + (i / steps) * PANEL.height;
    const halfWidth = panelHalfWidthAt(y);
    right.push(new THREE.Vector2(halfWidth, y));
    left.push(new THREE.Vector2(-halfWidth, y));
  }
  return new THREE.Shape([...right, ...left.reverse()]);
}

/**
 * Whether a disc of radius `r` centred at (x, y) in panel space lies wholly
 * inside the outline. Used by the fit test; sampling the circle rather than
 * just its centre is the whole point, since it is the instrument bezels that
 * overhang, not their centres.
 */
export function discFitsPanel(x: number, y: number, r: number): boolean {
  const SAMPLES = 24;
  for (let i = 0; i < SAMPLES; i++) {
    const theta = (i / SAMPLES) * Math.PI * 2;
    const px = x + Math.cos(theta) * r;
    const py = y + Math.sin(theta) * r;
    if (Math.abs(py) > PANEL_HALF_H) return false;
    if (Math.abs(px) > panelHalfWidthAt(py)) return false;
  }
  return true;
}
