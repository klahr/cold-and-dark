import * as THREE from 'three';

/**
 * Lofted surfaces, for the fuselage.
 *
 * A light aircraft fuselage is a continuous skin whose cross-section
 * changes smoothly from the firewall to the tail. Approximating it with
 * boxes is what makes a cockpit look blocky no matter how good the
 * materials are, so the shell here is generated properly: a stack of
 * cross-sections, stitched into a surface.
 */

export interface Section {
  /** Station along the fuselage, in world Z (negative is forward). */
  z: number;
  /** Half-width at the widest point. */
  halfWidth: number;
  /** Half-height. */
  halfHeight: number;
  /** Height of the section's centre above the cabin floor. */
  centreY: number;
  /**
   * Superellipse exponent. 2 is an ellipse; a 172 is nearer 3, which gives
   * the slab-sided-but-round-cornered look of a real fuselage.
   */
  squareness: number;
  /**
   * Angles, measured from straight up, bounding the greenhouse opening on
   * each side. Equal values mean the section is closed.
   */
  openTop: number;
  openBottom: number;
}

/**
 * A point on a section. `theta` is measured from straight up, positive
 * toward the right-hand side of the aircraft.
 */
export function sectionPoint(s: Section, theta: number): THREE.Vector3 {
  const e = 2 / s.squareness;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const x = s.halfWidth * Math.sign(sin) * Math.abs(sin) ** e;
  const y = s.centreY + s.halfHeight * Math.sign(cos) * Math.abs(cos) ** e;
  return new THREE.Vector3(x, y, s.z);
}

/** Linear interpolation between two sections, for subdividing a loft. */
export function lerpSection(a: Section, b: Section, t: number): Section {
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    z: mix(a.z, b.z),
    halfWidth: mix(a.halfWidth, b.halfWidth),
    halfHeight: mix(a.halfHeight, b.halfHeight),
    centreY: mix(a.centreY, b.centreY),
    squareness: mix(a.squareness, b.squareness),
    openTop: mix(a.openTop, b.openTop),
    openBottom: mix(a.openBottom, b.openBottom),
  };
}

/** Smoothstep, so the loft eases between stations instead of creasing. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Subdivides a list of stations so the skin curves smoothly along its length. */
export function subdivide(sections: readonly Section[], perSpan: number): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]!;
    const b = sections[i + 1]!;
    for (let k = 0; k < perSpan; k++) {
      out.push(lerpSection(a, b, ease(k / perSpan)));
    }
  }
  out.push(sections[sections.length - 1]!);
  return out;
}

export type Band = 'deck' | 'belly';

/**
 * Stitches a band of the skin across every station.
 *
 * The shell is built as two bands rather than one closed tube: the
 * turtledeck over the top and the belly underneath. Where they separate,
 * the gap between them is the greenhouse — which is how the window opening
 * ends up with properly curved edges instead of a rectangular hole.
 */
export function loftBand(
  sections: readonly Section[],
  band: Band,
  segments: number,
  flip = false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  sections.forEach((section, i) => {
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      // The deck runs from the left window header, over the top, to the
      // right; the belly runs from the right sill, under the bottom, to
      // the left.
      const theta =
        band === 'deck'
          ? -section.openTop + t * (2 * section.openTop)
          : section.openBottom + t * (2 * Math.PI - 2 * section.openBottom);
      const p = sectionPoint(section, theta);
      positions.push(p.x, p.y, p.z);
      uvs.push(t, i / Math.max(1, sections.length - 1));
    }
  });

  const stride = segments + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // `flip = false` must wind outward. Theta runs clockwise in the XY
      // plane (top, right, bottom, left) and `i` runs aft, so the winding
      // that gives an outward normal is (a, c, b) — not the (a, b, c) that
      // looks natural. Getting this backwards turned the whole fuselage
      // inside out: the skin faced into the cabin and the lining faced out,
      // so the pilot sat inside a white shell and the aeroplane appeared to
      // have a beige cabin side with no skin over it. Both materials are
      // pale, which is why it survived so long.
      if (flip) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Caps a loft at one end, for the tailcone tip. */
export function capSection(section: Section, segments: number, flip = false): THREE.BufferGeometry {
  const positions: number[] = [section.halfWidth * 0, section.centreY, section.z];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];

  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const p = sectionPoint(section, theta);
    positions.push(p.x, p.y, p.z);
    uvs.push(0.5 + Math.sin(theta) * 0.5, 0.5 + Math.cos(theta) * 0.5);
  }
  for (let j = 1; j <= segments; j++) {
    // Same convention as loftBand: flip = false faces outward.
    if (flip) indices.push(0, j + 1, j);
    else indices.push(0, j, j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
