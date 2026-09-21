import * as THREE from 'three';
import { MAT } from './materials';
import { box } from './geometry';
import { buildDoorFrames, buildFuselageSkin } from './fuselage';
import { buildAirport } from './airport';

/**
 * The outside world: the aeroplane's own airframe, the ground it stands on,
 * and the airfield around it (see airport.ts). The trainer never moves the
 * aircraft, but the windshield needs somewhere believable to look at, and a
 * recognisable apron-taxiway-runway layout also gives the checklist its
 * context — you can see where you would be taxiing to.
 */
export interface WorldHandle {
  group: THREE.Group;
  /** Spins the propeller. Called every frame with the engine's RPM. */
  update(dt: number, rpm: number): void;
  /**
   * Skin material of the cowl, wing and struts. The beacon and strobes tint
   * this rather than using real lights — see ExteriorLights for why.
   */
  airframeMaterial: THREE.MeshStandardMaterial;
}

export function buildWorld(scene: THREE.Scene): WorldHandle {
  const g = new THREE.Group();
  g.name = 'world';

  // The backdrop is the baked sky cube map set up in lighting.ts; the fog
  // colour is matched to its horizon so distant scenery blends into it. The
  // far distance is set beyond the treeline rather than at the runway, so
  // the airfield itself stays legible and only the boundary hazes out.
  scene.fog = new THREE.Fog(0xa8bdd4, 400, 1900);

  // The cabin floor of a parked 172 sits roughly a metre above the ramp.
  const GROUND_Y = -0.95;

  const ground = new THREE.Mesh(new THREE.CircleGeometry(1200, 64), MAT.grass());
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  g.add(ground);

  const airport = buildAirport();
  g.add(airport.group);

  // The parts of the airframe a seated pilot can actually see.
  const airframe = buildAirframe();
  g.add(airframe.group);

  scene.add(g);
  return {
    group: g,
    update(dt: number, rpm: number) {
      airframe.update(dt, rpm);
      airport.update(dt);
    },
    airframeMaterial: airframe.material,
  };
}

export const WING = { tipX: 5.1, y: 1.34, z: -0.30 } as const;

/** Centreline height of the engine cowl, and therefore of the propeller. */
const COWL_Y = 0.50;
/** Published chord of the constant-chord 172 wing. */
const WING_CHORD = 1.49;

function buildAirframe(): {
  group: THREE.Group;
  update: (dt: number, rpm: number) => void;
  material: THREE.MeshStandardMaterial;
} {
  const g = new THREE.Group();
  g.name = 'airframe';

  const cowlMat = new THREE.MeshStandardMaterial({
    color: 0xe9e9e6,
    roughness: 0.32,
    metalness: 0.25,
  });

  // Rotating the cylinder onto Z puts its "top" radius at the aft end, so the
  // cowl tapers correctly from the firewall forward to the spinner.
  // The lofted shell behind the firewall.
  g.add(buildFuselageSkin());
  g.add(buildDoorFrames());
  g.add(buildTail(cowlMat));
  g.add(buildLandingGear());

  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.30, 1.15, 28), cowlMat);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, COWL_Y, -1.42);
  cowl.castShadow = true;
  g.add(cowl);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.165, 0.30, 22), cowlMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, COWL_Y, -2.05);
  g.add(spinner);

  const propeller = buildPropeller();
  propeller.group.position.set(0, COWL_Y, -2.07);
  g.add(propeller.group);

  // High wing, built as an aerofoil rather than a slab, with the 172's
  // slight dihedral. It does not cast a shadow: the sun's shadow camera
  // only covers the cabin, and a wing this size would simply black the
  // interior out. The panel fill light stands in for the shade it throws.
  const chord = WING_CHORD;
  const thickness = 0.13;
  const aerofoil = new THREE.Shape();
  const upper: [number, number][] = [
    [-0.50, 0.00], [-0.44, 0.34], [-0.30, 0.50], [-0.08, 0.54],
    [0.16, 0.46], [0.50, 0.06],
  ];
  const lower: [number, number][] = [
    [0.16, -0.10], [-0.08, -0.17], [-0.30, -0.17], [-0.44, -0.10],
  ];
  aerofoil.moveTo(upper[0]![0] * chord, upper[0]![1] * thickness);
  for (const [c, t] of upper.slice(1)) aerofoil.lineTo(c * chord, t * thickness);
  for (const [c, t] of lower) aerofoil.lineTo(c * chord, t * thickness);
  aerofoil.closePath();

  const halfSpan = WING.tipX + 0.26;
  for (const side of [-1, 1] as const) {
    const panel = new THREE.Mesh(
      new THREE.ExtrudeGeometry(aerofoil, { depth: halfSpan, bevelEnabled: false, curveSegments: 4 }),
      cowlMat,
    );
    // Authored in (chord, thickness) and extruded spanwise.
    panel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    panel.position.set(0, WING.y, WING.z);
    // 1.7 degrees of dihedral, which is subtle but reads from head-on.
    panel.rotation.z = side * 0.03;
    panel.castShadow = false;
    g.add(panel);
  }

  // Wingtip fairings, where the position and strobe lights live.
  for (const side of [-1, 1] as const) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), cowlMat);
    tip.scale.set(1, 0.55, 3.4);
    tip.position.set(side * (WING.tipX + 0.26), WING.y, WING.z);
    tip.castShadow = false;
    g.add(tip);
  }

  // Lift struts, which are the piece of the wing structure you really see
  // from the left seat: they run down across the side windows.
  for (const side of [-1, 1] as const) {
    const top = new THREE.Vector3(side * 2.35, WING.y - 0.06, WING.z + 0.05);
    const bottom = new THREE.Vector3(side * 0.56, 0.32, -0.02);
    const mid = top.clone().add(bottom).multiplyScalar(0.5);
    const delta = top.clone().sub(bottom);

    const strut = box(0.075, delta.length(), 0.03, cowlMat, [mid.x, mid.y, mid.z]);
    strut.rotation.z = -Math.atan2(delta.x, delta.y);
    strut.rotation.x = Math.atan2(delta.z, delta.y);
    strut.castShadow = false;
    g.add(strut);
  }

  return { group: g, update: propeller.update, material: cowlMat };
}

/**
 * Two-blade fixed-pitch propeller.
 *
 * Below a few hundred RPM the individual blades are drawn and turned; above
 * that they are swapped for a translucent disc, because a pair of polygons
 * flickering at 20 revolutions a second just strobes against the frame rate.
 * The disc is the strongest single signal in the whole cockpit that the
 * engine has actually caught.
 */
function buildPropeller(): { group: THREE.Group; update: (dt: number, rpm: number) => void } {
  const group = new THREE.Group();
  group.name = 'propeller';

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x1e1f22,
    roughness: 0.5,
    metalness: 0.3,
  });

  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde3,
    roughness: 0.45,
    metalness: 0.2,
  });
  const warnMat = new THREE.MeshStandardMaterial({
    color: 0xc0392b,
    roughness: 0.45,
    metalness: 0.1,
  });

  // A real blade is a tapered, twisted aerofoil: wide and thick at the root,
  // narrow at the tip. An untapered slab reads as a stick.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.062, 0.06);
  bladeShape.lineTo(0.052, 0.06);
  bladeShape.lineTo(0.030, 0.95);
  bladeShape.lineTo(-0.028, 0.95);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.005,
    bevelSegments: 1,
  });

  const blades = new THREE.Group();
  for (const side of [-1, 1] as const) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMat);
    blade.rotation.z = side > 0 ? 0 : Math.PI;
    blade.rotation.y = side * 0.32;
    blade.castShadow = false;
    blades.add(blade);

    // Painted tip bands: the standard white-and-red warning marking, and the
    // only part of the blade you can pick out once it is turning.
    for (const [offset, mat] of [
      [0.89, tipMat],
      [0.82, warnMat],
      [0.75, tipMat],
    ] as const) {
      const band = box(0.062, 0.05, 0.028, mat, [0, side * offset, 0]);
      band.rotation.y = side * 0.32;
      band.castShadow = false;
      blades.add(band);
    }
  }
  group.add(blades);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 40),
    new THREE.MeshBasicMaterial({
      color: 0x20242a,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.visible = false;
  group.add(disc);

  // A brighter ring at the tips, where a real disc catches the light.
  const tipRing = new THREE.Mesh(
    new THREE.RingGeometry(0.88, 0.95, 48),
    new THREE.MeshBasicMaterial({
      color: 0xd8dce2,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  tipRing.visible = false;
  group.add(tipRing);

  // Parked blades are left off the vertical, or the prop reads as a mast
  // rather than a propeller.
  let angle = 0.95;
  blades.rotation.z = angle;
  return {
    group,
    update(dt: number, rpm: number) {
      angle += dt * (rpm / 60) * Math.PI * 2;
      blades.rotation.z = angle;

      const spinning = rpm > 320;
      blades.visible = !spinning;
      disc.visible = spinning;
      tipRing.visible = spinning;
      if (spinning) {
        const t = Math.min(1, (rpm - 320) / 1200);
        (disc.material as THREE.MeshBasicMaterial).opacity = 0.14 + t * 0.14;
        (tipRing.material as THREE.MeshBasicMaterial).opacity = 0.18 + t * 0.2;
      }
    },
  };
}

/**
 * Fin, rudder, tailplane and elevator. Swept surfaces rather than slabs:
 * the fin in particular has the distinctive swept leading edge that makes a
 * Cessna recognisable from half a mile away.
 */
function buildTail(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tail';

  // Vertical fin, authored in (z, y) and rotated into the fuselage plane.
  const finShape = new THREE.Shape();
  finShape.moveTo(3.95, 0.80);
  finShape.lineTo(5.30, 1.76);
  finShape.lineTo(5.94, 1.76);
  finShape.lineTo(6.08, 0.92);
  finShape.closePath();
  const fin = new THREE.Mesh(
    new THREE.ExtrudeGeometry(finShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.015,
      bevelSegments: 2,
    }),
    skin,
  );
  fin.rotation.y = -Math.PI / 2;
  fin.position.x = 0.025;
  fin.castShadow = false;
  g.add(fin);

  // Dorsal fillet running forward from the fin root.
  const filletShape = new THREE.Shape();
  filletShape.moveTo(2.70, 0.68);
  filletShape.lineTo(4.00, 0.84);
  filletShape.lineTo(4.00, 0.72);
  filletShape.closePath();
  const fillet = new THREE.Mesh(
    new THREE.ExtrudeGeometry(filletShape, { depth: 0.035, bevelEnabled: false }),
    skin,
  );
  fillet.rotation.y = -Math.PI / 2;
  fillet.position.x = 0.018;
  g.add(fillet);

  // Tailplane, straight and barely tapered as on the real aeroplane.
  const stabShape = new THREE.Shape();
  stabShape.moveTo(5.05, -1.70);
  stabShape.lineTo(5.05, 1.70);
  stabShape.lineTo(5.68, 1.48);
  stabShape.lineTo(5.68, -1.48);
  stabShape.closePath();
  const stab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(stabShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.012,
      bevelSegments: 2,
    }),
    skin,
  );
  stab.rotation.x = Math.PI / 2;
  stab.position.y = 0.86;
  stab.castShadow = false;
  g.add(stab);

  return g;
}

/** Fixed tricycle gear: sprung steel main legs and a raked nose leg. */
function buildLandingGear(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'gear';
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8,
    roughness: 0.45,
    metalness: 0.7,
  });

  const wheel = (x: number, y: number, z: number, radius: number) => {
    const tyre = new THREE.Mesh(
      new THREE.TorusGeometry(radius, radius * 0.42, 10, 20),
      MAT.rubber(),
    );
    tyre.rotation.y = Math.PI / 2;
    tyre.position.set(x, y, z);
    tyre.castShadow = false;
    g.add(tyre);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.5, 14),
      legMat,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, y, z);
    g.add(hub);
  };

  for (const side of [-1, 1] as const) {
    // The spring-steel legs are rooted in the belly, below the cabin floor,
    // and emerge through a fairing on the side of the fuselage. Rooting them
    // at (±0.12, +0.18) put the tops 18 cm *above* the floor, so both legs
    // stood up through the carpet in the middle of the cabin. The wheel
    // positions are unchanged, so the stance and track are unaffected.
    const leg = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.30, -0.08, 0.44),
          new THREE.Vector3(side * 0.70, -0.36, 0.48),
          new THREE.Vector3(side * 1.02, -0.72, 0.52),
        ]),
        16,
        0.032,
        8,
        false,
      ),
      legMat,
    );
    g.add(leg);
    wheel(side * 1.05, -0.78, 0.52, 0.19);

    const spat = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), MAT.skin());
    spat.scale.set(0.42, 0.75, 1.15);
    spat.position.set(side * 1.05, -0.74, 0.52);
    g.add(spat);
  }

  const nose = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.22, -1.05),
        new THREE.Vector3(0, -0.22, -1.32),
        new THREE.Vector3(0, -0.66, -1.46),
      ]),
      14,
      0.036,
      8,
      false,
    ),
    legMat,
  );
  g.add(nose);
  wheel(0, -0.74, -1.48, 0.16);
  const noseSpat = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), MAT.skin());
  noseSpat.scale.set(0.42, 0.75, 1.15);
  noseSpat.position.set(0, -0.70, -1.48);
  g.add(noseSpat);

  return g;
}
