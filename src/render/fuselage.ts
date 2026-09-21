import * as THREE from 'three';
import { capSection, lerpSection, loftBand, sectionPoint, subdivide, type Section } from './loft';
import { CABIN } from './frame';
import { faceExtrude } from './geometry';
import { MAT } from './materials';

/**
 * The 172 fuselage, as a single set of cross-sections.
 *
 * The same stations drive the outside skin and the inside lining, so the
 * cabin the pilot sits in is genuinely the inside of the shape you see from
 * outside — the sidewalls curve in under the seats and blend into the
 * headliner without a seam, which is what a real cabin does and what a box
 * with a cylinder on top never will.
 *
 * Window openings are not cut out of the skin. The shell is lofted as two
 * bands — a turtledeck over the top, a belly underneath — and where they
 * part company, the gap is the greenhouse.
 */

/** Aft end of the greenhouse. */
const CABIN_BACK = 1.22;
/**
 * Aft of this the opening is glazed as side windows; forward of it the
 * opening is the windscreen. The two meet exactly, with no overlap and no
 * gap. They used to be held 4 cm apart to keep the side glazing clear of the
 * screen, and that 4 cm was simply an unglazed slot in the side of the cabin.
 */
const GLAZING_FRONT = -0.58;
/** Station where the cabin lining — and so the windscreen header — begins. */
export const LINING_FRONT = -0.58;
/** Aft end of the cabin lining, where the rear bulkhead closes the cabin. */
const LINING_AFT = 1.35;
/**
 * The deck band stops here. Forward of the windscreen there is no cabin
 * roof — that is the engine bay, covered by the cowl — and running the
 * turtledeck all the way to the firewall walls the pilot in behind a blank
 * white surface where the view over the nose should be.
 */
/** Bottom of the windscreen, where the cowl deck stops. */
export const WINDSCREEN_BASE = -0.85;
/** Aft end of the aeroplane, set so overall length matches the real one. */
export const TAIL_TIP = 6.05;

/** Angles from vertical bounding the side glass. */
const HEADER = 0.72;
const SILL = 1.38;
/** A closed section: deck and belly meet, leaving no opening. */
const SHUT = 1.05;

/**
 * Stations from the spinner backplate to the tail tip.
 *
 * Dimensions are checked against the published C172N figures: 8.28 m
 * overall, 2.72 m to the fin tip, 1.0 m maximum cabin width. Getting the
 * length right matters more than it sounds — a tailcone that stops short
 * makes the whole aeroplane look stubby however good the cabin is.
 *
 * The cowl is part of this loft rather than a cylinder bolted to the front,
 * which is what removes the step at the firewall. Its stations are
 * deliberately low-topped: the deck ahead of the windscreen has to sit under
 * the pilot's sight line or it walls off the view over the nose.
 *
 * Section bottoms sit well below the cabin floor (y = 0). That is not
 * cosmetic. An earlier table put the hull bottom *at* y = 0 through the
 * cabin and at y = +0.11 at the firewall, which meant the cabin floor was at
 * or below the lowest point of a rounded hull — and a rounded hull has no
 * width at its lowest point. The flat floor slab therefore stuck out through
 * the belly, and the fuselage could be seen cutting across it. Dropping the
 * bottoms to roughly −0.15 gives a fuselage 1.4 m deep at the cabin, which
 * is both what the real aeroplane measures and enough hull for an 0.84 m
 * floor to sit inside.
 */
const STATIONS: Section[] = [
  // Cowl, forward of the firewall.
  { z: -2.00, halfWidth: 0.17, halfHeight: 0.170, centreY: 0.500, squareness: 2.2, openTop: SHUT, openBottom: SHUT },
  { z: -1.70, halfWidth: 0.26, halfHeight: 0.290, centreY: 0.460, squareness: 2.4, openTop: SHUT, openBottom: SHUT },
  { z: -1.30, halfWidth: 0.34, halfHeight: 0.370, centreY: 0.440, squareness: 2.5, openTop: SHUT, openBottom: SHUT },
  { z: -0.98, halfWidth: 0.42, halfHeight: 0.455, centreY: 0.435, squareness: 2.6, openTop: SHUT, openBottom: SHUT },
  { z: WINDSCREEN_BASE, halfWidth: 0.46, halfHeight: 0.500, centreY: 0.410, squareness: 2.7, openTop: SHUT, openBottom: SHUT },
  // Cabin. Full height is only reached at the windscreen header.
  { z: LINING_FRONT, halfWidth: 0.50, halfHeight: 0.675, centreY: 0.525, squareness: 3.0, openTop: HEADER, openBottom: SILL },
  { z: -0.10, halfWidth: 0.53, halfHeight: 0.705, centreY: 0.535, squareness: 3.2, openTop: HEADER, openBottom: SILL },
  { z: 0.40, halfWidth: 0.52, halfHeight: 0.690, centreY: 0.530, squareness: 3.1, openTop: HEADER, openBottom: SILL },
  { z: CABIN_BACK, halfWidth: 0.47, halfHeight: 0.630, centreY: 0.530, squareness: 3.0, openTop: SHUT, openBottom: SHUT },
  // Baggage bay, then the tailcone. The taper is deliberately gentle: a
  // tailcone that thins too quickly leaves the fin looking tacked onto a
  // wedge rather than growing out of a tube.
  { z: 2.20, halfWidth: 0.38, halfHeight: 0.505, centreY: 0.565, squareness: 2.9, openTop: SHUT, openBottom: SHUT },
  { z: 3.50, halfWidth: 0.28, halfHeight: 0.375, centreY: 0.655, squareness: 2.8, openTop: SHUT, openBottom: SHUT },
  { z: 4.80, halfWidth: 0.19, halfHeight: 0.260, centreY: 0.740, squareness: 2.6, openTop: SHUT, openBottom: SHUT },
  { z: TAIL_TIP, halfWidth: 0.10, halfHeight: 0.170, centreY: 0.820, squareness: 2.4, openTop: SHUT, openBottom: SHUT },
];

/** Inset of the cabin lining inboard of the skin. */
export const LINING_INSET = 0.022;

/**
 * Half-width of the cabin lining's inner surface at a point, or 0 if the
 * point is outside the hull.
 *
 * This is the function that stops the interior being authored by guesswork.
 * The instrument panel and the floor both take their outline from it, so
 * neither can end up wider than the cabin it has to fit inside — which is
 * exactly the bug it was written to kill: the panel was 1.04 m across where
 * the cabin measures 0.95 m, so its outer corners were buried in the
 * sidewall and the lining occluded the left of the six-pack from the pilot's
 * seat.
 */
export function cabinHalfWidthAt(z: number, y: number): number {
  const rings = sections();
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  if (z <= first.z || z >= last.z) return 0;

  let section = first;
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (z >= a.z && z <= b.z) {
      section = lerpSection(a, b, (z - a.z) / (b.z - a.z));
      break;
    }
  }

  const a = section.halfWidth - LINING_INSET;
  const b = section.halfHeight - LINING_INSET;
  const t = Math.abs((y - section.centreY) / b);
  if (t >= 1) return 0;
  return a * (1 - t ** section.squareness) ** (1 / section.squareness);
}

const DECK_SEGMENTS = 26;
const BELLY_SEGMENTS = 34;

function sections(): Section[] {
  return subdivide(STATIONS, 5);
}

/** The painted aluminium skin, seen from outside. */
export function buildFuselageSkin(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fuselage';
  const rings = sections();

  // Two deck runs: the cowl ahead of the windscreen, and the cabin roof and
  // tailcone behind it. The gap between them is the windscreen itself.
  const cowlDeck = new THREE.Mesh(
    loftBand(rings.filter((s) => s.z <= WINDSCREEN_BASE + 0.001), 'deck', DECK_SEGMENTS),
    MAT.skin(),
  );
  const roofDeck = new THREE.Mesh(
    loftBand(rings.filter((s) => s.z >= LINING_FRONT - 0.001), 'deck', DECK_SEGMENTS),
    MAT.skin(),
  );
  const belly = new THREE.Mesh(loftBand(rings, 'belly', BELLY_SEGMENTS), MAT.skin());
  for (const mesh of [cowlDeck, roofDeck, belly]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  // The panels either side of the windscreen, which the deck bands leave out.
  const closeout = new THREE.Mesh(windscreenCloseout(0), MAT.skin());
  closeout.receiveShadow = true;
  g.add(closeout);

  const tail = rings[rings.length - 1]!;
  g.add(new THREE.Mesh(capSection(tail, 24), MAT.skin()));

  return g;
}

/**
 * The cabin lining: the same shape, slightly inset, facing inward. This is
 * what the pilot actually sees to either side.
 */
export function buildCabinLining(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cabin-lining';

  // The lining laps a little way over the greenhouse edges rather than
  // stopping exactly on them. Skin and lining derive their window bounds from
  // the same angles, so in principle they meet precisely; in practice the two
  // are tessellated differently and the seam leaks hairline slits of daylight
  // along the sill and the header. Overlapping by 0.05 rad closes all of them
  // at once, and because the lining sits 22 mm inboard the lap hides behind
  // the window frames.
  const LAP = 0.05;
  const inset = (s: Section): Section => ({
    ...s,
    halfWidth: s.halfWidth - LINING_INSET,
    halfHeight: s.halfHeight - LINING_INSET,
    openTop: s.openTop + LAP,
    openBottom: Math.max(0, s.openBottom - LAP),
  });

  // The roof lining starts at the windscreen header — there is no cabin roof
  // forward of that.
  const deckRings = sections()
    .filter((s) => s.z >= LINING_FRONT && s.z <= LINING_AFT)
    .map(inset);

  // The sidewalls and floor pan, though, have to run all the way forward to
  // the firewall. Starting them at the header left the footwell sides
  // unlined, and because the skin faces outward an unlined patch is not a
  // white wall — it is a hole. The pilot could see the ramp through the sides
  // of their own footwell.
  // Reaching a little past the firewall on purpose. `subdivide` eases its
  // station spacing, so the nearest ring forward of the cabin lands at
  // z = -0.822; filtering at exactly the firewall dropped it and left the
  // lining's front rim at -0.755, which a sightline into the footwell could
  // just squeak past. The overlap is hidden behind the firewall bulkhead.
  const bellyRings = sections()
    .filter((s) => s.z >= CABIN.firewallZ - 0.1 && s.z <= LINING_AFT)
    .map(inset);

  const deck = new THREE.Mesh(loftBand(deckRings, 'deck', DECK_SEGMENTS, true), MAT.trim());
  const belly = new THREE.Mesh(loftBand(bellyRings, 'belly', BELLY_SEGMENTS, true), MAT.trim());
  // Cabin side of the windscreen closeout panels. Reversing the index order
  // turns the same band inward, so it lines the panels the skin makes.
  const closeoutGeo = windscreenCloseout(LINING_INSET);
  const idx = closeoutGeo.getIndex();
  if (idx) {
    const flipped = Array.from(idx.array);
    for (let i = 0; i < flipped.length; i += 3) {
      const t = flipped[i]!;
      flipped[i] = flipped[i + 2]!;
      flipped[i + 2] = t;
    }
    closeoutGeo.setIndex(flipped);
    closeoutGeo.computeVertexNormals();
  }
  const closeout = new THREE.Mesh(closeoutGeo, MAT.trim());
  for (const mesh of [deck, belly, closeout]) {
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  // Aft bulkhead. Without it the cabin is an open tube: looking behind the
  // seats the sightline ran past the end of the lining and straight out
  // through the tailcone, which was by far the largest hole in the cabin.
  const aft = bellyRings[bellyRings.length - 1];
  if (aft) {
    const profile: THREE.Vector2[] = [];
    const STEPS = 48;
    for (let i = 0; i < STEPS; i++) {
      const p = sectionPoint(aft, (i / STEPS) * Math.PI * 2);
      profile.push(new THREE.Vector2(p.x, p.y));
    }
    const bulkhead = faceExtrude(new THREE.Shape(profile), 0.015, MAT.trim(), 0);
    // faceExtrude leaves the visible face at local z = 0 pointing +z, so the
    // bulkhead has to be turned to face forward into the cabin.
    bulkhead.rotation.y = Math.PI;
    bulkhead.position.z = aft.z;
    bulkhead.name = 'aft-bulkhead';
    g.add(bulkhead);
  }

  return g;
}

/**
 * The rolled edge around the greenhouse: the window sill and the header
 * rail, which on the real aeroplane are the visible structure between the
 * skin outside and the lining inside.
 */
export function buildWindowFrames(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'window-frames';
  const rings = sections().filter((s) => s.z >= GLAZING_FRONT && s.z <= CABIN_BACK + 0.01);

  for (const side of [-1, 1] as const) {
    for (const [angleKey, radius] of [
      ['openTop', 0.017],
      ['openBottom', 0.021],
    ] as const) {
      const points = rings.map((s) => {
        const theta = side * s[angleKey];
        const e = 2 / s.squareness;
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        return new THREE.Vector3(
          s.halfWidth * Math.sign(sin) * Math.abs(sin) ** e,
          s.centreY + s.halfHeight * Math.sign(cos) * Math.abs(cos) ** e,
          s.z,
        );
      });
      const curve = new THREE.CatmullRomCurve3(points);
      const rail = new THREE.Mesh(
        new THREE.TubeGeometry(curve, rings.length * 2, radius, 8, false),
        MAT.trim(),
      );
      rail.castShadow = false;
      g.add(rail);
    }
  }

  return g;
}

/** Glass filling the greenhouse on each side, following the same curve. */
export function buildSideGlass(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'side-glass';
  const rings = sections().filter((s) => s.z >= GLAZING_FRONT && s.z <= CABIN_BACK + 0.01);

  for (const side of [-1, 1] as const) {
    const band = rings.map((s) => ({
      ...s,
      openTop: side > 0 ? s.openTop : s.openTop,
      openBottom: s.openBottom,
    }));
    const positions: number[] = [];
    const indices: number[] = [];
    band.forEach((s) => {
      for (const theta of [side * s.openTop, side * s.openBottom]) {
        const e = 2 / s.squareness;
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        positions.push(
          s.halfWidth * Math.sign(sin) * Math.abs(sin) ** e,
          s.centreY + s.halfHeight * Math.sign(cos) * Math.abs(cos) ** e,
          s.z,
        );
      }
    });
    for (let i = 0; i < band.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const glass = new THREE.Mesh(geometry, MAT.glass());
    glass.castShadow = false;
    g.add(glass);
  }

  return g;
}

/**
 * The curve the windscreen has to meet: the deck band's leading edge, at
 * the station where the cabin lining starts. Returned left-to-right so the
 * cockpit can sweep a pane onto it without a seam.
 */
export function windscreenHeader(samples: number): THREE.Vector3[] {
  const station =
    sections().find((s) => s.z >= LINING_FRONT) ?? STATIONS[1]!;
  const inset = 0.022;
  const s: Section = {
    ...station,
    halfWidth: station.halfWidth - inset,
    halfHeight: station.halfHeight - inset,
  };
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const theta = -s.openTop + (i / samples) * (2 * s.openTop);
    const e = 2 / s.squareness;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    points.push(
      new THREE.Vector3(
        s.halfWidth * Math.sign(sin) * Math.abs(sin) ** e,
        s.centreY + s.halfHeight * Math.sign(cos) * Math.abs(cos) ** e,
        s.z,
      ),
    );
  }
  return points;
}

/** Fore and aft edges of the pilot's door, in fuselage stations. */
const DOOR_FRONT = -0.56;
const DOOR_BACK = 0.44;

/** A point on a station at a given angle from vertical. */
function pointAt(s: Section, theta: number): THREE.Vector3 {
  const e = 2 / s.squareness;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return new THREE.Vector3(
    s.halfWidth * Math.sign(sin) * Math.abs(sin) ** e,
    s.centreY + s.halfHeight * Math.sign(cos) * Math.abs(cos) ** e,
    s.z,
  );
}

/** The station nearest a given z. */
function stationAt(z: number): Section {
  const all = sections();
  return all.reduce((best, s) => (Math.abs(s.z - z) < Math.abs(best.z - z) ? s : best), all[0]!);
}

/**
 * The trailing arc of the cowl deck, at the windscreen base.
 *
 * This is the aperture's lower boundary over the nose, and so where the
 * windscreen pane has to spring from. The pane used to start from a straight
 * lip drawn across the cowl apex at y = 0.899, which is up to 18 cm above the
 * skin's actual edge — an open wedge under the whole width of the screen,
 * hidden inboard by the glareshield and wide open either side of it.
 */
export function windscreenBaseArc(samples: number): THREE.Vector3[] {
  const station = stationAt(WINDSCREEN_BASE);
  const s: Section = {
    ...station,
    z: WINDSCREEN_BASE,
    halfWidth: station.halfWidth - LINING_INSET,
    halfHeight: station.halfHeight - LINING_INSET,
  };
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const theta = -s.openTop + (i / samples) * (2 * s.openTop);
    points.push(pointAt(s, theta));
  }
  return points;
}

/**
 * The triangular panels either side of the windscreen.
 *
 * The pane's side edge runs from the cowl deck's corner up to the header's
 * corner, but the aperture's side boundary is the belly band's edge, which
 * bulges outboard while the pane's edge draws inboard. The lens between them
 * is genuinely skin on the real aeroplane, and has to be modelled or it is a
 * hole.
 *
 * It matters that this is a band *on the hull surface* and not a flat panel
 * across the gap. The first attempt ruled a straight strip between the two
 * edges, which left a crescent of daylight between the chord and the curved
 * hull — small enough to be invisible, big enough for a sightline to thread.
 *
 * `bandInset` is 0 for the outer skin and `LINING_INSET` for the cabin side.
 */
export function windscreenCloseout(bandInset: number, spans = 18, arcs = 8): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (const side of [1, -1] as const) {
    for (let i = 0; i <= spans; i++) {
      const z = WINDSCREEN_BASE + (i / spans) * (LINING_FRONT - WINDSCREEN_BASE);
      const station = stationAt(z);
      const s: Section = {
        ...station,
        z,
        halfWidth: station.halfWidth - bandInset,
        halfHeight: station.halfHeight - bandInset,
      };
      // Lapped past the aperture edges at both ends. The windscreen pane and
      // the header arc are built on the *inset* surface, while the skin is
      // not, so a band that stops exactly on `openTop` misses the pane's edge
      // by the 22 mm inset — a slot right at the top corner of the screen,
      // which was the last leak left in the cabin. The lap is hidden under
      // the roof deck outside and the A-pillar inside.
      const LAP = 0.07;
      const from = s.openTop - LAP;
      const to = s.openBottom + LAP;
      for (let j = 0; j <= arcs; j++) {
        const t = j / arcs;
        // Theta always increases, on both sides, so the winding handedness
        // matches loftBand's and `flip = false` faces outward either way.
        const theta = side > 0 ? from + t * (to - from) : -to + t * (to - from);
        const p = pointAt(s, theta);
        positions.push(p.x, p.y, p.z);
      }
    }
    const stride = arcs + 1;
    for (let i = 0; i < spans; i++) {
      for (let j = 0; j < arcs; j++) {
        const a = base + i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    base = positions.length / 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Door outlines and the post between the door window and the rear window.
 *
 * Without these the greenhouse is one continuous slot running the length of
 * the cabin, which is the last thing that gives away a simplified shell: a
 * real 172 has a door with a visible cut line, and a separate rear window
 * behind the door post.
 */
export function buildDoorFrames(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'door-frames';

  for (const side of [-1, 1] as const) {
    // Post between the door window and the rear window.
    const postStation = stationAt(DOOR_BACK);
    const postPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const theta = side * (postStation.openTop + t * (postStation.openBottom - postStation.openTop));
      postPoints.push(pointAt(postStation, theta));
    }
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(postPoints), 12, 0.013, 8, false),
        MAT.trim(),
      ),
    );

    // Door cut line: down the front edge, along the bottom, up the back.
    const cut: THREE.Vector3[] = [];
    const frontStation = stationAt(DOOR_FRONT);
    for (let i = 0; i <= 6; i++) {
      const theta = side * (frontStation.openBottom + (i / 6) * (2.05 - frontStation.openBottom));
      cut.push(pointAt(frontStation, theta));
    }
    const lowRings = sections().filter((s) => s.z >= DOOR_FRONT && s.z <= DOOR_BACK);
    for (const s of lowRings) cut.push(pointAt(s, side * 2.05));
    const backStation = stationAt(DOOR_BACK);
    for (let i = 6; i >= 0; i--) {
      const theta = side * (backStation.openBottom + (i / 6) * (2.05 - backStation.openBottom));
      cut.push(pointAt(backStation, theta));
    }
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cut), 90, 0.008, 6, false),
        MAT.trim(),
      ),
    );

    // Door handle, just below the sill.
    const handleStation = stationAt(0.02);
    const anchor = pointAt(handleStation, side * (handleStation.openBottom + 0.16));
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.035, 0.12),
      MAT.frame(),
    );
    handle.position.copy(anchor);
    g.add(handle);
  }

  return g;
}
