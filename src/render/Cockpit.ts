import * as THREE from 'three';
import { CABIN, PANEL, PANEL_HALF_H, SEAT } from './frame';
import { panelHalfWidthAt, panelOutline } from './panelShape';
import { MAT } from './materials';
import {
  box,
  cylinder,
  faceExtrude,
  mergeStatic,
  roundedRectShape,
  tube,
} from './geometry';
import { makeLabel } from './text';
import {
  buildCabinLining,
  buildSideGlass,
  buildWindowFrames,
  cabinHalfWidthAt,
  LINING_FRONT,
  windscreenBaseArc,
  windscreenHeader,
} from './fuselage';

export interface CockpitShell {
  /** Everything static, parented to the world. */
  group: THREE.Group;
  /**
   * Panel-space frame. Aircraft definitions place controls and instruments as
   * children of this group using flat (x, y) panel coordinates with z = 0 on
   * the panel face and +z pointing at the pilot.
   */
  panel: THREE.Group;
  /** Floor console frame; the fuel selector lives here. */
  console: THREE.Group;
  /** Sub-panel below the panel centre; the trim wheel lives here. */
  pedestal: THREE.Group;
  /** Both control wheels, so the view can be cleared for teaching. */
  yokes: THREE.Group[];
  /**
   * The yoke's own material instance. The control wheel sits squarely
   * between the pilot and the lower switch band — true to life, and the
   * single biggest obstacle to seeing what you are being asked to touch —
   * so the trainer fades it when it is in the way.
   */
  yokeMaterial: THREE.MeshStandardMaterial;
}

/** Windshield geometry, shared by the glass, the posts and the closeouts. */
const WINDSHIELD = {
  baseY: 0.905,
  baseZ: -0.85,
  topY: CABIN.roofY,
  topZ: -0.60,
};


export function buildCockpit(): CockpitShell {
  const group = new THREE.Group();
  group.name = 'cockpit';

  group.add(buildFloor());
  group.add(buildFirewall());
  // The cabin walls and roof are the inside of the lofted fuselage, not a
  // pair of flat panels with an arch over the top.
  group.add(buildCabinLining());
  group.add(buildWindowFrames());
  group.add(buildSideGlass());
  group.add(buildCabinFittings());
  group.add(buildWindscreen());
  group.add(buildGlareshield());

  const panel = buildPanel();
  group.add(panel);

  group.add(buildSeat(SEAT.pilotX));
  group.add(buildSeat(SEAT.copilotX));
  const yokeMaterial = MAT.yoke().clone();
  const yokes = [
    buildYokeAssembly(SEAT.pilotX, yokeMaterial),
    buildYokeAssembly(SEAT.copilotX, yokeMaterial),
  ];
  for (const yoke of yokes) group.add(yoke);
  group.add(buildRudderPedals(SEAT.pilotX));
  group.add(buildRudderPedals(SEAT.copilotX));

  const pedestal = buildPedestal();
  group.add(pedestal);
  const console_ = buildConsole();
  group.add(console_);

  return { group, panel, console: console_, pedestal, yokes, yokeMaterial };
}

/**
 * The cabin floor, as a strip that follows the hull rather than a slab.
 *
 * It used to be a plain box the full 1.0 m cabin width. Because the fuselage
 * is round, a constant-width floor is wider than the hull for most of its
 * length, so its edges pushed out through the belly and the fuselage could be
 * seen slicing across the carpet. Taking the half-width from
 * `cabinHalfWidthAt` at floor height instead means the floor edge always
 * lands exactly where the sidewall rises out of it.
 */
function buildFloor(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'floor';

  const SPANS = 24;
  const THICKNESS = 0.02;
  const zFront = CABIN.firewallZ;
  const zBack = CABIN.aftBulkheadZ;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SPANS; i++) {
    const t = i / SPANS;
    const z = zFront + t * (zBack - zFront);
    // Sampled a touch above the floor surface, so the edge tucks just inside
    // the lining rather than landing exactly on it and z-fighting.
    const halfWidth = Math.max(0.04, cabinHalfWidthAt(z, CABIN.floorY + 0.004) - 0.004);
    positions.push(-halfWidth, CABIN.floorY, z, halfWidth, CABIN.floorY, z);
    uvs.push(0, t * 4, 1, t * 4);
  }
  for (let i = 0; i < SPANS; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  top.setIndex(indices);
  top.computeVertexNormals();

  const mesh = new THREE.Mesh(top, MAT.carpet());
  mesh.name = 'floor-pan';
  mesh.receiveShadow = true;
  g.add(mesh);

  // A shallow skirt down from the floor edge, so a glance down the side of
  // the seat shows a floor with an edge rather than a paper-thin sheet.
  const skirt: number[] = [];
  const skirtIdx: number[] = [];
  const skirtUv: number[] = [];
  for (let i = 0; i <= SPANS; i++) {
    const t = i / SPANS;
    const z = zFront + t * (zBack - zFront);
    const halfWidth = Math.max(0.04, cabinHalfWidthAt(z, CABIN.floorY + 0.004) - 0.004);
    for (const side of [-1, 1] as const) {
      skirt.push(side * halfWidth, CABIN.floorY, z, side * halfWidth, CABIN.floorY - THICKNESS, z);
      skirtUv.push(0, t * 4, 1, t * 4);
    }
  }
  for (let i = 0; i < SPANS; i++) {
    for (const s of [0, 2] as const) {
      const a = i * 4 + s;
      skirtIdx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
    }
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
  skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUv, 2));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  const skirtMesh = new THREE.Mesh(skirtGeo, MAT.carpet());
  skirtMesh.material = MAT.carpet();
  skirtMesh.name = 'floor-edge';
  g.add(skirtMesh);

  return g;
}

function buildFirewall(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'firewall';

  // Forward bulkhead closing off the footwell. Cut to the hull rather than
  // run at the full cabin width: at the firewall station the fuselage is only
  // 0.31 m half-width down at floor level, so a 0.50 m slab pushed straight
  // out through the belly and could be seen crossing the footwell floor.
  const SPANS = 16;
  const wallTop = 0.40;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= SPANS; i++) {
    const y = CABIN.floorY + (i / SPANS) * (wallTop - CABIN.floorY);
    profile.push(new THREE.Vector2(cabinHalfWidthAt(CABIN.firewallZ, y) - 0.004, y));
  }
  const mirrored = profile.map((p) => new THREE.Vector2(-p.x, p.y)).reverse();
  const bulkhead = faceExtrude(new THREE.Shape([...profile, ...mirrored]), 0.02, MAT.trim());
  bulkhead.position.z = CABIN.firewallZ + 0.01;
  bulkhead.name = 'firewall-bulkhead';
  g.add(bulkhead);

  // Closeout sloping from the bottom edge of the panel down to the firewall,
  // hiding the wiring behind the switch band. Matched to the panel's own
  // bottom edge so the two line up instead of the closeout standing proud.
  const bottomY = PANEL.center[1] - PANEL_HALF_H * Math.cos(PANEL.tiltX);
  const bottomZ = PANEL.center[2] - PANEL_HALF_H * Math.sin(PANEL.tiltX);
  const dy = bottomY - wallTop;
  const dz = bottomZ - CABIN.firewallZ;
  const closeout = box(
    panelHalfWidthAt(-PANEL_HALF_H) * 2,
    Math.hypot(dy, dz),
    0.015,
    MAT.trim(),
    [0, (bottomY + wallTop) / 2, (bottomZ + CABIN.firewallZ) / 2],
  );
  closeout.rotation.x = Math.atan2(dz, dy);
  g.add(closeout);

  return g;
}

/**
 * Where the cabin sidewall is, for anything that has to sit against it.
 *
 * Clamped into the lining's own z range, because the lining is what a fitting
 * has to be flush with and it does not exist forward of the windscreen.
 */
function cabinSurfaceX(z: number, y: number): number {
  return cabinHalfWidthAt(Math.max(z, LINING_FRONT), y);
}

/**
 * The bits of cabin structure that are not part of the lofted skin: the
 * door posts, the armrests and the sill capping.
 */
function buildCabinFittings(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cabin-fittings';

  // Each fitting is placed against the sidewall where the sidewall actually
  // is at that station and height. A constant CABIN.halfWidth put all of them
  // at ±0.48, which is outside the lining everywhere except the very middle
  // of the cabin, so they sat half-buried in the wall.
  for (const side of [-1, 1] as const) {
    // Armrest along the door, just under the window sill.
    const armrestX = cabinSurfaceX(0.08, 0.55);
    const armrest = box(0.07, 0.04, 0.44, MAT.trim(), [side * (armrestX - 0.035), 0.55, 0.08]);
    armrest.rotation.z = side * 0.06;
    g.add(armrest);

    // Door posts fore and aft of the side window.
    for (const z of [-0.60, 0.66] as const) {
      const postX = cabinSurfaceX(z, 0.74);
      const height = z < 0 ? 0.30 : 0.26;
      g.add(box(0.035, height, 0.05, MAT.trim(), [side * (postX - 0.014), 0.74, z]));
    }
  }

  return g;
}

/**
 * The windscreen: a single curved pane, swept from the glareshield lip up
 * to the cabin roof. A 172 screen is a smooth wrap, not two flat sheets
 * meeting at a ridge.
 */
function buildWindscreen(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'windscreen';

  const SPANS = 22;
  const RISE = 14;

  // The top edge is not a straight line: it is the leading edge of the
  // cabin roof, which curves. Sweeping the pane onto that exact curve is
  // what removes the seam between the screen and the shell.
  const header = windscreenHeader(SPANS);
  // Both edges of the pane are arcs taken from the shell: the cowl deck's
  // trailing edge below and the cabin roof's leading edge above. The pane
  // therefore fills the aperture in the skin exactly, which is the only way
  // to be sure there is no gap along either of them.
  const base = windscreenBaseArc(SPANS);

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= RISE; i++) {
    const t = i / RISE;
    for (let j = 0; j <= SPANS; j++) {
      const u = (j / SPANS) * 2 - 1;
      const top = header[j]!;
      const bottom = base[j]!;
      // Bulge the middle of the screen forward, as a wrapped pane does.
      const bulge = (1 - u * u) * 0.05 * Math.sin(Math.PI * t);
      positions.push(
        bottom.x + (top.x - bottom.x) * t,
        bottom.y + (top.y - bottom.y) * t,
        bottom.z + (top.z - bottom.z) * t - bulge,
      );
    }
  }
  for (let i = 0; i < RISE; i++) {
    for (let j = 0; j < SPANS; j++) {
      const a = i * (SPANS + 1) + j;
      indices.push(a, a + 1, a + SPANS + 1, a + 1, a + SPANS + 2, a + SPANS + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const pane = new THREE.Mesh(geometry, MAT.glass());
  pane.castShadow = false;
  g.add(pane);

  // Centre post, following the same sweep as the pane.
  const mid = Math.floor(SPANS / 2);
  const postPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= RISE; i++) {
    const t = i / RISE;
    const top = header[mid]!;
    const bottom = base[mid]!;
    postPoints.push(
      new THREE.Vector3(
        0,
        bottom.y + (top.y - bottom.y) * t,
        bottom.z + (top.z - bottom.z) * t - 0.05 * Math.sin(Math.PI * t),
      ),
    );
  }
  g.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(postPoints), 20, 0.014, 8, false),
      MAT.trim(),
    ),
  );

  // A-pillars down each edge of the screen.
  for (const j of [0, SPANS]) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= RISE; i++) {
      const t = i / RISE;
      const top = header[j]!;
      const bottom = base[j]!;
      points.push(
        new THREE.Vector3(
          bottom.x + (top.x - bottom.x) * t,
          bottom.y + (top.y - bottom.y) * t,
          bottom.z + (top.z - bottom.z) * t,
        ),
      );
    }
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, 0.018, 8, false),
        MAT.trim(),
      ),
    );
  }

  // Header rail capping the top of the screen.
  g.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(header), 28, 0.016, 8, false),
      MAT.trim(),
    ),
  );

  // Corner castings where each A-pillar meets the header rail. Three surfaces
  // converge here — pillar, rail, and the edge of the windscreen closeout —
  // and a three-way seam between round tubes always leaves slivers open, even
  // when every part is individually correct. This was the last place daylight
  // got into the cabin.
  for (const j of [0, SPANS]) {
    const corner = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), MAT.trim());
    corner.position.copy(header[j]!);
    corner.name = 'windscreen-corner';
    g.add(corner);
  }

  return g;
}

function buildGlareshield(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glareshield';

  const frontZ = WINDSHIELD.baseZ;
  const rearZ = PANEL.center[2] + PANEL_HALF_H * Math.sin(PANEL.tiltX) - 0.005;
  const depth = Math.abs(rearZ - frontZ);
  const topY = WINDSHIELD.baseY;
  // Width taken from the cabin at the bolster's own height, not from the
  // panel. At PANEL.width + 0.03 it was 1.07 m across inside a cabin that
  // measures 0.89 m at glareshield height, so both ends of the roll — the
  // most prominent shape in the pilot's view — were buried in the sidewall.
  const width = Math.max(0.2, cabinHalfWidthAt(LINING_FRONT, topY) - 0.014) * 2;

  // The glareshield on a 172 is not a shelf: it is a thick padded bolster
  // that wraps the whole top of the panel, with a fat rounded roll along the
  // edge nearest the pilot. It is the dominant shape in the pilot's view and
  // the thing that reads most wrongly when it is modelled as a thin plate.
  const ROLL_R = 0.042;

  const deck = box(width, 0.03, depth, MAT.glareshield(), [
    0,
    topY - 0.015,
    (frontZ + rearZ) / 2,
  ]);
  deck.rotation.x = -0.05;
  g.add(deck);

  // The rolled rear edge, run as a lathe so it is genuinely round.
  const roll = new THREE.Mesh(
    new THREE.CylinderGeometry(ROLL_R, ROLL_R, width, 28),
    MAT.glareshield(),
  );
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, topY - ROLL_R + 0.014, rearZ - ROLL_R * 0.3);
  g.add(roll);

  // Rounded caps so the bolster does not end in a flat disc at each side.
  for (const side of [-1, 1] as const) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(ROLL_R, 18, 12), MAT.glareshield());
    cap.scale.set(0.8, 1, 1);
    cap.position.set(side * width * 0.5, topY - ROLL_R + 0.012, rearZ - ROLL_R * 0.35);
    g.add(cap);
  }

  // Outboard cheeks: the bolster sweeps down the sides of the panel toward
  // the door posts, which is what gives the panel its wrapped look.
  for (const side of [-1, 1] as const) {
    const cheek = box(0.05, 0.16, depth * 0.8, MAT.glareshield(), [
      side * (width * 0.5 - 0.012),
      topY - 0.085,
      (frontZ + rearZ) / 2 + 0.01,
    ]);
    cheek.rotation.z = side * 0.12;
    g.add(cheek);
  }

  return g;
}

function buildPanel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'panel';
  g.position.set(PANEL.center[0], PANEL.center[1], PANEL.center[2]);
  g.rotation.x = PANEL.tiltX;

  // Main panel face. Extruded backwards so local z = 0 is the visible surface.
  const outline = panelOutline();
  const face = faceExtrude(outline, PANEL.thickness, MAT.panel());
  face.name = 'panel-face';
  g.add(face);

  // Everything below is static decor. It is collected rather than added, so
  // that sixty-odd fasteners and trim strips become two draw calls instead
  // of sixty-odd — this panel is what makes the scene draw-call bound.
  const plates: THREE.Mesh[] = [];
  const fittings: THREE.Mesh[] = [];

  // Trim line separating the instrument area from the lower switch band. Cut
  // to the outline, like everything else that used to run the full width.
  const trimY = -0.105;
  fittings.push(
    box(panelHalfWidthAt(trimY) * 2 - 0.006, 0.006, 0.006, MAT.bezel(), [0, trimY, 0.004]),
  );

  // Radio stack surround, centre-right of the panel.
  fittings.push(box(0.175, 0.44, 0.010, MAT.bezel(), [0.085, 0.02, 0.005]));

  // Edge trim following the outline, as a thin extruded ring. A pair of
  // straight strips at ±PANEL_HALF_W no longer has anything to sit on.
  const ring = new THREE.Shape(panelOutline().getPoints(64));
  ring.holes.push(
    new THREE.Path(
      panelOutline()
        .getPoints(64)
        .map((p) => p.clone().multiplyScalar(0.975)),
    ),
  );
  const edgeTrim = faceExtrude(ring, 0.008, MAT.bezel());
  edgeTrim.position.z = 0.004;
  edgeTrim.name = 'panel-edge-trim';
  g.add(edgeTrim);

  // Removable sub-panel plates. On the real aeroplane the instrument area is
  // a separate shock-mounted plate screwed to the main panel, and the seam
  // and its fasteners are clearly visible. Narrowed from 0.37/0.32 so they
  // stay inside the outline; the instruments themselves never reached that
  // far out, so no aircraft layout had to move.
  collectSubPanel(plates, fittings, -0.335, 0.055, 0.33, 0.40);
  collectSubPanel(plates, fittings, 0.350, 0.13, 0.28, 0.26);

  // Fasteners along the top and bottom edges, walked in from the outline at
  // each end rather than from a fixed half-width.
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    for (const [edgeY, screwY] of [
      [PANEL_HALF_H - 0.017, PANEL_HALF_H - 0.017],
      [-PANEL_HALF_H + 0.016, -PANEL_HALF_H + 0.016],
    ] as const) {
      const halfWidth = panelHalfWidthAt(edgeY) - 0.014;
      fittings.push(screw(-halfWidth + t * halfWidth * 2, screwY));
    }
  }

  const platesMesh = mergeStatic(plates, MAT.panel(), 'panel-subplates');
  if (platesMesh) g.add(platesMesh);
  const fittingsMesh = mergeStatic(fittings, MAT.frame(), 'panel-fittings');
  if (fittingsMesh) g.add(fittingsMesh);

  return g;
}

/** A recessed sub-panel plate with fasteners around its edge. */
function collectSubPanel(
  plates: THREE.Mesh[],
  fittings: THREE.Mesh[],
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  // Strictly behind the instrument faces: on the real aeroplane the
  // instruments are mounted *through* this plate, not sitting on top of it.
  const plate = faceExtrude(roundedRectShape(w, h, 0.012), 0.003, MAT.panel(), 0.001);
  plate.position.set(cx, cy, 0.0016);
  plates.push(plate);

  const inset = 0.014;
  const cols = Math.max(2, Math.round(w / 0.085));
  const rows = Math.max(2, Math.round(h / 0.085));
  for (let i = 0; i <= cols; i++) {
    const x = cx - w / 2 + inset + (i / cols) * (w - inset * 2);
    fittings.push(screw(x, cy - h / 2 + inset, 0.0022));
    fittings.push(screw(x, cy + h / 2 - inset, 0.0022));
  }
  for (let j = 1; j < rows; j++) {
    const y = cy - h / 2 + inset + (j / rows) * (h - inset * 2);
    fittings.push(screw(cx - w / 2 + inset, y, 0.0022));
    fittings.push(screw(cx + w / 2 - inset, y, 0.0022));
  }
}

/** A single countersunk fastener head. */
function screw(x: number, y: number, z = 0.0035): THREE.Mesh {
  const mesh = cylinder(0.0021, 0.0026, 0.0012, MAT.frame(), 8);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  return mesh;
}

function buildSeat(x: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `seat-${x < 0 ? 'pilot' : 'copilot'}`;
  g.position.x = x;

  g.add(
    box(0.44, 0.08, SEAT.backZ - SEAT.frontZ, MAT.seat(), [
      0,
      SEAT.panY,
      (SEAT.frontZ + SEAT.backZ) / 2,
    ]),
  );

  const back = box(0.44, 0.56, 0.09, MAT.seat(), [0, SEAT.panY + 0.29, SEAT.backZ + 0.02]);
  back.rotation.x = -0.14;
  g.add(back);

  for (const side of [-1, 1] as const) {
    g.add(box(0.03, 0.014, 0.70, MAT.frame(), [side * 0.18, 0.012, 0.28]));
    g.add(box(0.045, SEAT.panY - 0.05, 0.045, MAT.frame(), [side * 0.18, SEAT.panY / 2, 0.18]));
  }

  return g;
}

function buildYokeAssembly(x: number, yokeMat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  g.name = `yoke-${x < 0 ? 'pilot' : 'copilot'}`;

  // Origin is the yoke hub, a forearm's reach from the seat back.
  const hubY = 0.60;
  const hubZ = -0.34;
  const panelY = 0.66;
  const panelZ = PANEL.center[2];
  const tilt = Math.atan2(panelY - hubY, hubZ - panelZ);
  g.position.set(x, hubY, hubZ);

  // Control column running forward and slightly up into the panel.
  const len = Math.hypot(panelY - hubY, hubZ - panelZ);
  const column = cylinder(0.022, 0.022, len, yokeMat, 16);
  column.rotation.x = Math.PI / 2 - tilt;
  column.position.set(0, (panelY - hubY) / 2, (panelZ - hubZ) / 2);
  g.add(column);

  // The wheel sits in a plane square to the column.
  const wheel = new THREE.Group();
  wheel.rotation.x = -tilt;
  g.add(wheel);

  const hub = cylinder(0.036, 0.036, 0.026, yokeMat, 24);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);

  // The maker's badge on the hub. Small, but it is the thing your eye lands
  // on every time you look at the yoke, and a blank hub reads as unfinished.
  const badge = makeLabel('SKYHAWK', {
    size: 0.0055,
    color: '#c8ccd2',
    background: '#1a1c1f',
    padding: 0.5,
  });
  badge.position.z = 0.0145;
  wheel.add(badge);

  // Ram's-horn control wheel: a tube swept through the classic W profile.
  wheel.add(
    tube(
      [
        [-0.165, 0.052, 0.026],
        [-0.148, 0.008, 0.010],
        [-0.088, -0.020, 0.003],
        [0.0, -0.028, 0.0],
        [0.088, -0.020, 0.003],
        [0.148, 0.008, 0.010],
        [0.165, 0.052, 0.026],
      ],
      0.013,
      yokeMat,
    ),
  );

  // Push-to-talk and electric trim switches on the grips.
  for (const side of [-1, 1] as const) {
    const boss = cylinder(0.0075, 0.0075, 0.006, MAT.bezel(), 12);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(side * 0.158, 0.036, 0.034);
    wheel.add(boss);
  }

  return g;
}

function buildRudderPedals(x: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `pedals-${x < 0 ? 'pilot' : 'copilot'}`;
  g.position.set(x, 0, -0.66);

  for (const side of [-1, 1] as const) {
    const pedal = box(0.07, 0.12, 0.018, MAT.frame(), [side * 0.095, 0.15, -0.05]);
    pedal.rotation.x = 0.35;
    g.add(pedal);

    const arm = box(0.02, 0.018, 0.20, MAT.frame(), [side * 0.095, 0.09, 0.04]);
    arm.rotation.x = -0.35;
    g.add(arm);
  }

  return g;
}

function buildPedestal(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pedestal';
  // Sub-panel below the centre of the main panel, carrying the trim wheel.
  g.add(box(0.19, 0.30, 0.14, MAT.trim(), [0, 0.22, PANEL.center[2] - 0.02]));
  return g;
}

function buildConsole(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'console';
  // Floor console between the seats carrying the fuel selector.
  g.add(box(0.22, 0.14, 0.30, MAT.trim(), [0, 0.07, -0.12]));

  // Hand extinguisher, bracketed to the floor ahead of the console. Every
  // 172 has one and it is the brightest object in the cabin.
  const bottleMat = new THREE.MeshStandardMaterial({
    color: 0xb4241c,
    roughness: 0.34,
    metalness: 0.25,
  });
  const bottle = cylinder(0.042, 0.042, 0.23, bottleMat, 18);
  bottle.rotation.x = Math.PI / 2 - 0.22;
  bottle.position.set(0.0, 0.11, -0.40);
  g.add(bottle);

  const neck = cylinder(0.016, 0.02, 0.05, MAT.frame(), 12);
  neck.rotation.x = Math.PI / 2 - 0.22;
  neck.position.set(0.0, 0.145, -0.53);
  g.add(neck);

  const strap = box(0.095, 0.022, 0.03, MAT.frame(), [0, 0.11, -0.33]);
  g.add(strap);

  return g;
}
