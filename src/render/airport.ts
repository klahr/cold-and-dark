import * as THREE from 'three';
import { MAT } from './materials';
import { box, mergeStatic } from './geometry';
import { fbm } from './textures';

/**
 * The airfield the aeroplane is parked on.
 *
 * Everything here is built with the draw-call budget in mind, because the
 * scene was carefully got down to under 200 calls and an airport is exactly
 * the kind of content that quietly puts it back up to thousands:
 *
 *  - Pavement markings are thin planes merged into one mesh per surface,
 *    not one mesh per stripe.
 *  - Trees, grass, flowers, edge lights and tie-downs are `InstancedMesh`,
 *    so several thousand objects cost one draw call each.
 *  - Buildings are merged per material.
 *
 * Layout, with the aeroplane at the origin facing −Z. It follows the route
 * you would actually taxi, which matters because the whole point of the app
 * is the procedure: the aeroplane stands on a tie-down row near the front
 * edge of the apron, a stub leads out to a parallel taxiway crossing the
 * view, a connector runs from that to a hold-short, and the runway lies
 * beyond. Looking over the nose you read those off as bands of pavement and
 * grass receding to the treeline.
 *
 * An earlier version made the apron one large slab with the aeroplane in the
 * middle of it, which put nothing but tarmac in every window — the bands are
 * both more legible and much closer to a real field.
 */

const GROUND_Y = -0.95;
/** Pavement sits a couple of centimetres above the grass to avoid z-fighting. */
const PAVE_Y = GROUND_Y + 0.02;
const MARK_Y = PAVE_Y + 0.012;

/** The ramp. Shallow, so grass starts only ~20 m off the nose. */
const APRON = { halfWidth: 34, zNear: 22, zFar: -24 };
/** Half-width of every taxiway here; 23 m overall suits a light-aircraft field. */
const TAXI_HALF = 11.5;
/** Stub connecting the apron to the parallel taxiway. */
const STUB = { zStart: -24, zEnd: -60 };
/** Taxiway A, running parallel to the runway across the field of view. */
const PARALLEL = { zNear: -60, zFar: -83, halfLength: 380 };
/** Connector A1, from taxiway A out to the runway hold-short. */
const CONNECTOR = { zStart: -83, zEnd: -243 };
/**
 * Hard standing in front of the hangar row, joined to the main apron. Without
 * it the hangars sit straight on the grass, which no real hangar does — an
 * aeroplane has to be able to be pulled out of one.
 */
const HANGAR_PAD = { xNear: 30, xFar: 178, zNear: 7, zFar: -9 };
const HOLD_Z = -239;
const RUNWAY = { z: -262, halfWidth: 15, halfLength: 700 };

export interface AirportHandle {
  group: THREE.Group;
  /** Drifts the clouds, which is the only thing out here that moves. */
  update(dt: number): void;
}

export function buildAirport(): AirportHandle {
  const g = new THREE.Group();
  g.name = 'airport';

  g.add(buildInfield());
  g.add(buildPavement());
  g.add(buildMarkings());
  g.add(buildEdgeLights());
  g.add(buildTower());
  g.add(buildHangars());
  g.add(buildWindsock());
  g.add(buildSigns());
  g.add(buildFence());
  g.add(buildRampTraffic());
  g.add(buildTrees());
  g.add(buildMeadow());

  const clouds = buildClouds();
  g.add(clouds.object);

  return { group: g, update: clouds.update };
}

/* ------------------------------------------------------------------ */
/* Pavement                                                            */
/* ------------------------------------------------------------------ */

/**
 * The mown infield.
 *
 * Without it the ground is one flat green plain out to the horizon, which is
 * the single thing that most gives away a procedurally-placed airfield: real
 * ground has large-scale tonal structure. A mowing boundary supplies exactly
 * that, it is genuinely a feature of every airfield, and it costs one draw
 * call. Its own edges sit far enough out to be lost in haze.
 */
function buildInfield(): THREE.Mesh {
  const depth = AIRFIELD.zNear - AIRFIELD.zFar;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(AIRFIELD.halfWidth * 2, depth), MAT.grass());
  mesh.material = mesh.material.clone();
  mesh.material.name = 'grass-mown';
  // Cut grass is lighter and yellower than the rough beyond the boundary.
  mesh.material.color.setRGB(1.24, 1.2, 0.92);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, GROUND_Y + 0.008, (AIRFIELD.zNear + AIRFIELD.zFar) / 2);
  mesh.receiveShadow = true;
  mesh.name = 'infield';
  return mesh;
}

function slab(width: number, length: number, cx: number, cz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), MAT.asphalt());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, PAVE_Y, cz);
  mesh.receiveShadow = true;
  return mesh;
}

function buildPavement(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pavement';

  const span = (a: number, b: number) => Math.abs(a - b);
  const mid = (a: number, b: number) => (a + b) / 2;

  g.add(slab(APRON.halfWidth * 2, span(APRON.zNear, APRON.zFar), 0, mid(APRON.zNear, APRON.zFar)));
  g.add(slab(TAXI_HALF * 2, span(STUB.zStart, STUB.zEnd), 0, mid(STUB.zStart, STUB.zEnd)));
  g.add(
    slab(
      PARALLEL.halfLength * 2,
      span(PARALLEL.zNear, PARALLEL.zFar),
      0,
      mid(PARALLEL.zNear, PARALLEL.zFar),
    ),
  );
  g.add(
    slab(TAXI_HALF * 2, span(CONNECTOR.zStart, CONNECTOR.zEnd), 0, mid(CONNECTOR.zStart, CONNECTOR.zEnd)),
  );
  g.add(slab(RUNWAY.halfLength * 2, RUNWAY.halfWidth * 2, 0, RUNWAY.z));
  g.add(
    slab(
      span(HANGAR_PAD.xNear, HANGAR_PAD.xFar),
      span(HANGAR_PAD.zNear, HANGAR_PAD.zFar),
      mid(HANGAR_PAD.xNear, HANGAR_PAD.xFar),
      mid(HANGAR_PAD.zNear, HANGAR_PAD.zFar),
    ),
  );

  // Fillets where the connector meets the parallel taxiway and the runway.
  // Real junctions are widened like this so a turning aeroplane's inside
  // wheel stays on pavement.
  g.add(slab(TAXI_HALF * 2 + 22, 16, 0, PARALLEL.zFar - 6));
  g.add(slab(TAXI_HALF * 2 + 26, 22, 0, RUNWAY.z + RUNWAY.halfWidth + 10));

  return g;
}

/* ------------------------------------------------------------------ */
/* Markings                                                            */
/* ------------------------------------------------------------------ */

/**
 * A painted stripe lying on the pavement: `width` runs along world X,
 * `length` along world Z.
 */
function stripe(width: number, length: number, cx: number, cz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, MARK_Y, cz);
  return mesh;
}

function buildMarkings(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'markings';

  const white: THREE.Mesh[] = [];
  const yellow: THREE.Mesh[] = [];

  /* ---------------- Runway ---------------- */
  // Edge lines down both sides.
  for (const side of [-1, 1] as const) {
    white.push(
      stripe(RUNWAY.halfLength * 2, 0.9, 0, RUNWAY.z + side * (RUNWAY.halfWidth - 0.9)),
    );
  }
  // Centreline: 30 m painted, 20 m gap.
  for (let x = -RUNWAY.halfLength + 20; x < RUNWAY.halfLength; x += 50) {
    white.push(stripe(30, 0.9, x, RUNWAY.z));
  }
  // Touchdown zone bars either side of the centreline, both directions.
  for (const dir of [-1, 1] as const) {
    for (const [i, count] of [[0, 3], [1, 2], [2, 1]] as const) {
      const x = dir * (RUNWAY.halfLength - 160 - i * 150);
      for (let k = 0; k < count; k++) {
        for (const side of [-1, 1] as const) {
          white.push(stripe(22, 1.8, x, RUNWAY.z + side * (4.5 + k * 3.2)));
        }
      }
    }
    // Aiming point: two fat bars.
    for (const side of [-1, 1] as const) {
      white.push(stripe(45, 6, dir * (RUNWAY.halfLength - 300), RUNWAY.z + side * 8.5));
    }
    // Threshold piano keys.
    for (let k = 0; k < 6; k++) {
      const offset = (k - 2.5) * 3.6;
      white.push(stripe(26, 1.8, dir * (RUNWAY.halfLength - 20), RUNWAY.z + offset));
    }
  }

  /* ---------------- Taxiways ---------------- */
  /** A centreline plus its two edge lines, along Z. */
  const alongZ = (zStart: number, zEnd: number) => {
    const length = Math.abs(zStart - zEnd);
    const cz = (zStart + zEnd) / 2;
    yellow.push(stripe(0.6, length, 0, cz));
    for (const side of [-1, 1] as const) {
      yellow.push(stripe(0.3, length, side * (TAXI_HALF - 0.6), cz));
    }
  };

  alongZ(STUB.zStart, STUB.zEnd);
  alongZ(CONNECTOR.zStart, CONNECTOR.zEnd);

  // Taxiway A crosses the view, so its centreline runs along X instead.
  const parallelMid = (PARALLEL.zNear + PARALLEL.zFar) / 2;
  yellow.push(stripe(PARALLEL.halfLength * 2, 0.6, 0, parallelMid));
  for (const side of [-1, 1] as const) {
    yellow.push(
      stripe(PARALLEL.halfLength * 2, 0.3, 0, parallelMid + side * (TAXI_HALF - 0.6)),
    );
  }
  // Curved fillet centrelines guiding the turn from the stub onto A — the one
  // piece of taxi guidance a student actually has to follow by eye.
  //
  // A quarter arc tangent to both centrelines: tangency to x = 0 and to
  // z = parallelMid puts the centre at (±R, parallelMid + R), and sweeping
  // t from 0 to pi/2 runs from one tangent point to the other.
  for (const side of [-1, 1] as const) {
    const R = 13;
    const cx = side * R;
    const cz = parallelMid + R;
    const steps = 14;
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * (Math.PI / 2);
      yellow.push(
        stripe(0.6, 0.6, cx - side * R * Math.cos(t), cz - R * Math.sin(t)),
      );
    }
  }

  /* ---------------- Hold short ---------------- */
  // Two solid lines on the approach side, two dashed beyond: the marking
  // every pilot is taught never to cross without a clearance.
  for (const [i, dashed] of [[0, false], [1, false], [2, true], [3, true]] as const) {
    const z = HOLD_Z + i * 0.9;
    if (!dashed) {
      yellow.push(stripe(TAXI_HALF * 2, 0.35, 0, z));
    } else {
      for (let k = -6; k <= 6; k++) {
        yellow.push(stripe(1.1, 0.35, k * 1.8, z));
      }
    }
  }

  /* ---------------- Apron ---------------- */
  // A row of tie-down stands 12 m apart. The aeroplane occupies the middle
  // one, at x = 0, so its lead-in line runs away under the nose.
  for (let i = -2; i <= 2; i++) {
    const x = i * 12;
    // Lead-in line from the taxi lane at the back of the apron to the stand.
    yellow.push(stripe(0.35, 20, x, 11));
    // Nosewheel stop bar, and the wing tie-down marks either side of it.
    yellow.push(stripe(1.6, 0.3, x, -1.5));
    for (const side of [-1, 1] as const) {
      yellow.push(stripe(1.0, 0.25, x + side * 5.1, 1.2));
    }
  }
  // The taxi lane along the back of the apron that serves the stands.
  yellow.push(stripe(APRON.halfWidth * 2 - 4, 0.5, 0, APRON.zNear - 3));

  /* ---------------- Hangar row ---------------- */
  // A taxilane down the hard standing, with a lead line turning in to each
  // hangar door.
  const padLaneZ = HANGAR_PAD.zNear - 4;
  yellow.push(
    stripe(
      HANGAR_PAD.xFar - HANGAR_PAD.xNear - 6,
      0.5,
      (HANGAR_PAD.xNear + HANGAR_PAD.xFar) / 2,
      padLaneZ,
    ),
  );
  for (let i = 0; i < 3; i++) {
    const hx = 72 + i * 40;
    yellow.push(stripe(0.5, Math.abs(padLaneZ - HANGAR_PAD.zFar), hx, (padLaneZ + HANGAR_PAD.zFar) / 2));
  }

  // Runway paint is retroreflective and kept repainted, so it is much
  // brighter than the weathered ramp markings MAT.marking is tuned for.
  const whitePaint = new THREE.MeshStandardMaterial({
    color: 0xeceae2,
    roughness: 0.7,
    metalness: 0,
  });
  const whiteMesh = mergeStatic(white, whitePaint, 'runway-markings');
  if (whiteMesh) g.add(whiteMesh);

  const yellowPaint = new THREE.MeshStandardMaterial({
    color: 0xd9b134,
    roughness: 0.78,
    metalness: 0,
  });
  const yellowMesh = mergeStatic(yellow, yellowPaint, 'taxiway-markings');
  if (yellowMesh) g.add(yellowMesh);

  return g;
}

/* ------------------------------------------------------------------ */
/* Lights                                                              */
/* ------------------------------------------------------------------ */

/** Taxiway edge (blue), runway edge (white) and PAPI, as instanced studs. */
function buildEdgeLights(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'airfield-lights';

  const place = (
    positions: THREE.Vector3[],
    colour: number,
    radius: number,
    name: string,
  ) => {
    if (positions.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(radius, 8, 6),
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      }),
      positions.length,
    );
    mesh.name = name;
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    mesh.instanceMatrix.needsUpdate = true;
    g.add(mesh);
  };

  // Blue edge lights down every taxiway. The ones on the stub and connector
  // run along Z; taxiway A's run along X.
  const taxi: THREE.Vector3[] = [];
  for (const run of [STUB, CONNECTOR]) {
    for (let z = run.zStart; z > run.zEnd; z -= 24) {
      for (const side of [-1, 1] as const) {
        taxi.push(new THREE.Vector3(side * (TAXI_HALF + 1.5), PAVE_Y + 0.18, z));
      }
    }
  }
  for (let x = -PARALLEL.halfLength; x <= PARALLEL.halfLength; x += 28) {
    for (const [zEdge, offset] of [
      [PARALLEL.zNear, 1.5],
      [PARALLEL.zFar, -1.5],
    ] as const) {
      // Leave a gap where the stub and connector join, as real fields do.
      if (Math.abs(x) < TAXI_HALF + 4) continue;
      taxi.push(new THREE.Vector3(x, PAVE_Y + 0.18, zEdge + offset));
    }
  }
  place(taxi, 0x2a5ed8, 0.18, 'taxiway-lights');

  const runway: THREE.Vector3[] = [];
  for (let x = -RUNWAY.halfLength; x <= RUNWAY.halfLength; x += 60) {
    for (const side of [-1, 1] as const) {
      runway.push(new THREE.Vector3(x, PAVE_Y + 0.2, RUNWAY.z + side * (RUNWAY.halfWidth + 2)));
    }
  }
  place(runway, 0xf2efe4, 0.2, 'runway-lights');

  // PAPI, on the left of the approach end.
  const papi: THREE.Vector3[] = [];
  for (let k = 0; k < 4; k++) {
    papi.push(new THREE.Vector3(-120 + k * 2.4, PAVE_Y + 0.5, RUNWAY.z - 28));
  }
  place(papi, 0xd8452f, 0.3, 'papi');

  return g;
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

function buildTower(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tower';

  // Off the left wing, near enough to read as part of the field rather than
  // scenery on the horizon, far enough not to crowd the windows.
  const X = -92;
  const Z = -52;
  const base = GROUND_Y;
  const concrete = new THREE.MeshStandardMaterial({
    color: 0xb9b4a8,
    roughness: 0.9,
    metalness: 0,
  });
  const glazing = new THREE.MeshStandardMaterial({
    color: 0x2c3a44,
    roughness: 0.15,
    metalness: 0.4,
  });

  const shell: THREE.Mesh[] = [];
  // A hard standing at the foot, so the tower is not growing out of a field.
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(22, 20), MAT.asphalt());
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(X, PAVE_Y, Z + 2);
  pad.receiveShadow = true;
  g.add(pad);

  // Shaft, stepping in as it rises.
  shell.push(box(9, 7, 9, concrete, [X, base + 3.5, Z]));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.6, 12, 16), concrete);
  shaft.position.set(X, base + 13, Z);
  shell.push(shaft);
  // Gallery floor under the cab, oversailing the shaft.
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 4.6, 0.8, 16), concrete);
  gallery.position.set(X, base + 19.2, Z);
  shell.push(gallery);
  // Roof cap.
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.2, 0.7, 16), concrete);
  roof.position.set(X, base + 24.6, Z);
  shell.push(roof);

  const merged = mergeStatic(shell, concrete, 'tower-shell');
  if (merged) g.add(merged);

  // The cab: canted glass, which is what makes a tower read as a tower.
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.3, 4.6, 16, 1, true), glazing);
  cab.position.set(X, base + 22, Z);
  g.add(cab);

  // Railing round the gallery.
  const rail = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.07, 6, 20), MAT.frame());
  rail.rotation.x = Math.PI / 2;
  rail.position.set(X, base + 20.6, Z);
  g.add(rail);

  // Mast and beacon on top.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 8), MAT.frame());
  mast.position.set(X, base + 27.4, Z);
  g.add(mast);

  return g;
}

function buildHangars(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hangars';
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8f9298,
    roughness: 0.72,
    metalness: 0.25,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x6b7076,
    roughness: 0.6,
    metalness: 0.35,
  });

  const walls: THREE.Mesh[] = [];
  const doors: THREE.Mesh[] = [];

  // A row off the right wing, doors facing the apron, which is where a GA
  // field puts its T-hangars.
  for (let i = 0; i < 3; i++) {
    const x = 72 + i * 40;
    const z = -22;
    const w = 34;
    const d = 26;
    const h = 6.5;

    walls.push(box(w, h, d, wallMat, [x, GROUND_Y + h / 2, z]));

    // Shallow barrel roof, rising 3.6 m over a 34 m span.
    //
    // Built as a full open-ended cylinder squashed flat, with its lower half
    // buried in the walls, rather than as a half-cylinder. A half-cylinder
    // needs a rotation that puts the dome up and the axis along the building's
    // depth, and getting that wrong is silent: the first attempt laid the
    // barrel across the span and bulged it backwards, which read as a 23 m
    // grain silo. The full cylinder only needs its axis pointed, and the
    // hidden half is merged away with everything else.
    const RISE = 3.6;
    const r = w / 2;
    const roofGeo = new THREE.CylinderGeometry(r, r, d, 20, 1, true);
    // Axis along Z (the building's depth). Done on the geometry so the
    // squash below acts on true world Y.
    roofGeo.rotateX(Math.PI / 2);
    roofGeo.scale(1, RISE / r, 1);
    const roof = new THREE.Mesh(roofGeo, wallMat);
    roof.position.set(x, GROUND_Y + h, z);
    walls.push(roof);

    // Sliding doors facing the apron.
    doors.push(box(w - 3, h - 0.6, 0.4, doorMat, [x, GROUND_Y + (h - 0.6) / 2, z + d / 2 + 0.2]));
  }

  const wallMesh = mergeStatic(walls, wallMat, 'hangar-shells');
  if (wallMesh) g.add(wallMesh);
  const doorMesh = mergeStatic(doors, doorMat, 'hangar-doors');
  if (doorMesh) g.add(doorMesh);

  return g;
}

function buildWindsock(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'windsock';
  const X = 30;
  const Z = -232;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), MAT.frame());
  pole.position.set(X, GROUND_Y + 2.5, Z);
  g.add(pole);

  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.52, 2.4, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xdd5a1e,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  // Streaming off the pole in the prevailing wind.
  sock.rotation.z = Math.PI / 2;
  sock.rotation.y = 0.5;
  sock.position.set(X + 1.2, GROUND_Y + 4.8, Z - 0.6);
  g.add(sock);

  // The ring of white segment markers round the base of the pole.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.08, 6, 24), MAT.marking());
  ring.rotation.x = Math.PI / 2;
  ring.position.set(X, PAVE_Y + 0.05, Z);
  g.add(ring);

  return g;
}

/** Hold-position and taxiway identification signs. */
function buildSigns(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'airfield-signs';

  const face = (text: string, background: string, ink: string): THREE.Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    if (c) {
      c.fillStyle = background;
      c.fillRect(0, 0, 256, 128);
      c.strokeStyle = '#f0ede4';
      c.lineWidth = 8;
      c.strokeRect(4, 4, 248, 120);
      c.fillStyle = ink;
      c.font = '700 74px ui-sans-serif, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, 128, 68);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const put = (text: string, bg: string, ink: string, x: number, z: number) => {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshStandardMaterial({ map: face(text, bg, ink), roughness: 0.8 }),
    );
    plate.position.set(x, GROUND_Y + 1.1, z);
    g.add(plate);
    const legs = box(2.3, 0.08, 0.08, MAT.frame(), [x, GROUND_Y + 0.5, z]);
    g.add(legs);
  };

  // Red mandatory sign at the hold short, yellow location sign on the apron.
  put('09-27', '#8f2b22', '#f5f1e8', -17, HOLD_Z + 3);
  put('A', '#b8901f', '#22201a', 17, -60);

  return g;
}

/**
 * The security fence behind the ramp.
 *
 * Every airfield has one, and it does real work in the picture: it gives the
 * eye a horizontal reference at a known distance, which is what lets the rest
 * of the field read as receding rather than as a flat backdrop.
 */
function buildFence(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fence';

  const Z = APRON.zNear + 9;
  const halfLength = 150;
  const height = 2.1;
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9a9e9f,
    roughness: 0.55,
    metalness: 0.7,
  });

  const posts: THREE.Mesh[] = [];
  for (let x = -halfLength; x <= halfLength; x += 3.2) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, height, 5), metal);
    post.position.set(x, GROUND_Y + height / 2, Z);
    posts.push(post);
  }
  // Top rail, and a suggestion of mesh as two slack horizontal wires. Real
  // chain-link would need an alpha-tested texture; at this distance and
  // viewing angle wires read the same and cost nothing.
  for (const y of [height, height * 0.62, height * 0.3]) {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, halfLength * 2, 5),
      metal,
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, GROUND_Y + y, Z);
    posts.push(rail);
  }

  const merged = mergeStatic(posts, metal, 'fence-line');
  if (merged) g.add(merged);
  return g;
}

/**
 * The other aeroplanes on the row, and the fuel bowser.
 *
 * Crude — a fuselage, a wing, a fin and gear — but an empty ramp with a
 * single aeroplane on it looks like a test scene, and at 12 m and more these
 * shapes are unmistakably light aircraft.
 */
function buildRampTraffic(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ramp-traffic';

  const skin = new THREE.MeshStandardMaterial({
    color: 0xe4e6e3,
    roughness: 0.38,
    metalness: 0.12,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1f3d63, roughness: 0.4 });
  const rubber = MAT.rubber();
  const parts: THREE.Mesh[] = [];
  const trimParts: THREE.Mesh[] = [];
  const rubberParts: THREE.Mesh[] = [];

  // Two neighbours, one either side, on the stands the markings lay out.
  for (const [x, yaw] of [
    [-24, 0.08],
    [24, -0.12],
  ] as const) {
    const plane = new THREE.Group();
    plane.position.set(x, GROUND_Y, 0.5);
    plane.rotation.y = yaw;

    // Heights are above ground, matched to the 172 this app models: wheels
    // 0.3 m, fuselage centreline ~1.2 m, wing ~2.3 m.
    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.58, 5.4, 4, 10), skin);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.set(0, 1.28, 0.4);
    plane.add(fuselage);

    const wing = box(10.9, 0.19, 1.5, skin, [0, 2.26, -0.3]);
    plane.add(wing);
    // Lift struts, without which a high-wing aeroplane looks wrong.
    for (const side of [-1, 1] as const) {
      const strut = box(0.1, 1.6, 0.22, skin, [side * 2.6, 1.55, -0.2]);
      strut.rotation.z = side * 0.55;
      plane.add(strut);
    }

    const fin = box(0.12, 1.6, 1.1, skin, [0, 2.1, 3.0]);
    plane.add(fin);
    const tailplane = box(3.4, 0.12, 0.85, skin, [0, 1.5, 3.1]);
    plane.add(tailplane);

    // A stripe down the side, which is what actually makes it read as a
    // specific aeroplane rather than a white blob.
    const stripeMesh = box(0.05, 0.16, 4.4, trim, [0.56, 1.12, 0.4]);
    plane.add(stripeMesh);

    for (const [gx, gz, r] of [
      [-1.5, 0.9, 0.31],
      [1.5, 0.9, 0.31],
      [0, -1.9, 0.2],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.42, 6, 12), rubber);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(gx, r, gz);
      plane.add(wheel);
      const leg = box(0.1, 1.0, 0.1, skin, [gx * 0.8, 0.72, gz]);
      plane.add(leg);
    }

    plane.updateMatrixWorld(true);
    plane.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const baked = new THREE.Mesh(geo, o.material as THREE.Material);
      if (o.material === trim) trimParts.push(baked);
      else if (o.material === skin) parts.push(baked);
      else rubberParts.push(baked);
    });
  }

  // Fuel bowser, parked clear of the stands at the back of the ramp.
  const bowser = new THREE.Group();
  // On the ramp, at the back and clear of the stands — not out on the grass.
  bowser.position.set(-27, GROUND_Y, 17);
  bowser.rotation.y = 1.5;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.6, 14), skin);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.3, 1.5, 0);
  bowser.add(tank);
  bowser.add(box(1.9, 1.3, 2.0, skin, [2.2, 1.0, 0]));
  bowser.add(box(0.35, 1.5, 2.1, trim, [-2.2, 1.5, 0]));
  for (const [wx, wz] of [
    [1.9, 1.0],
    [1.9, -1.0],
    [-0.9, 1.0],
    [-0.9, -1.0],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.16, 6, 12), rubber);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    bowser.add(wheel);
  }
  bowser.updateMatrixWorld(true);
  bowser.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const baked = new THREE.Mesh(geo, o.material as THREE.Material);
    if (o.material === trim) trimParts.push(baked);
    else if (o.material === skin) parts.push(baked);
    else rubberParts.push(baked);
  });

  const skinMesh = mergeStatic(parts, skin, 'ramp-traffic-skin');
  if (skinMesh) g.add(skinMesh);
  const trimMesh = mergeStatic(trimParts, trim, 'ramp-traffic-trim');
  if (trimMesh) g.add(trimMesh);
  const rubberMesh = mergeStatic(rubberParts, rubber, 'ramp-traffic-tyres');
  if (rubberMesh) g.add(rubberMesh);
  return g;
}

/* ------------------------------------------------------------------ */
/* Vegetation                                                          */
/* ------------------------------------------------------------------ */

/** Deterministic scatter, so the airfield is the same on every reload. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * The operational area, kept clear of anything tall. It has to enclose the
 * full 1400 m runway, so it is much wider than it is deep.
 */
const AIRFIELD = { halfWidth: RUNWAY.halfLength + 140, zNear: 90, zFar: -360 } as const;

/** True inside the mown, obstacle-free part of the field. */
function insideAirfield(x: number, z: number): boolean {
  return Math.abs(x) < AIRFIELD.halfWidth && z < AIRFIELD.zNear && z > AIRFIELD.zFar;
}

/**
 * True where pavement or buildings already are, so scatter does not grow
 * through them. The margins are generous — a tuft poking out of the edge of
 * a taxiway is more noticeable than a slightly bare verge.
 */
function occupied(x: number, z: number): boolean {
  const near = (v: number, a: number, b: number, pad: number) =>
    v < Math.max(a, b) + pad && v > Math.min(a, b) - pad;

  if (Math.abs(x) < APRON.halfWidth + 5 && near(z, APRON.zNear, APRON.zFar, 5)) return true;
  if (Math.abs(x) < TAXI_HALF + 5 && near(z, STUB.zStart, CONNECTOR.zEnd, 3)) return true;
  if (Math.abs(x) < PARALLEL.halfLength + 5 && near(z, PARALLEL.zNear, PARALLEL.zFar, 5)) {
    return true;
  }
  if (Math.abs(z - RUNWAY.z) < RUNWAY.halfWidth + 16) return true;
  // Hangar row, its hard standing, and the tower plot.
  if (x > 50 && x < 172 && z > -40 && z < -4) return true;
  if (
    x > HANGAR_PAD.xNear - 4 &&
    x < HANGAR_PAD.xFar + 4 &&
    z < HANGAR_PAD.zNear + 4 &&
    z > HANGAR_PAD.zFar - 4
  ) {
    return true;
  }
  if (x > -104 && x < -80 && z > -64 && z < -40) return true;
  return false;
}

function buildTrees(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trees';
  const random = rng(20240619);

  const spots: { x: number; z: number; scale: number }[] = [];

  // Two belts rather than one. A single ring of trees all at one radius reads
  // as a cardboard cut-out pasted on the horizon; overlapping belts at
  // different depths give the treeline thickness, which is most of what makes
  // a distant boundary look real.
  //
  // Both belts are clipped to outside AIRFIELD. Rejecting only pavement is
  // not enough: sampling a ring centred on the aeroplane scatters trees right
  // through the middle of the field, and the result looks like a forest with
  // an airport hacked out of it. A real field is open mown grass out to the
  // boundary, and only then trees.
  const belt = (count: number, rMin: number, rSpan: number, sMin: number, sSpan: number) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = rMin + random() * rSpan;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 140;
      if (insideAirfield(x, z)) continue;
      // Nothing tall under the approaches at either end of the runway.
      if (Math.abs(z - RUNWAY.z) < 130 && Math.abs(x) < RUNWAY.halfLength + 400) continue;
      spots.push({ x, z, scale: sMin + random() * sSpan });
    }
  };
  belt(520, 340, 260, 0.8, 0.85);
  belt(700, 520, 560, 0.9, 1.3);

  if (spots.length === 0) return g;

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 0.95 });

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.34, 4, 6),
    trunkMat,
    spots.length,
  );
  const canopies = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.6, 0),
    leafMat,
    spots.length,
  );
  trunks.name = 'tree-trunks';
  canopies.name = 'tree-canopies';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();

  spots.forEach((s, i) => {
    q.setFromAxisAngle(axis, random() * Math.PI * 2);

    pos.set(s.x, GROUND_Y + 2 * s.scale, s.z);
    scl.setScalar(s.scale);
    trunks.setMatrixAt(i, m.compose(pos, q, scl));

    pos.set(s.x, GROUND_Y + (4.4 + random() * 0.8) * s.scale, s.z);
    scl.set(
      s.scale * (0.85 + random() * 0.4),
      s.scale * (1 + random() * 0.5),
      s.scale * (0.85 + random() * 0.4),
    );
    canopies.setMatrixAt(i, m.compose(pos, q, scl));

    // Per-instance tint. Free — it rides along in the instance buffer — and
    // it is what stops a few hundred identical canopies reading as a texture.
    tint.setHSL(0.24 + random() * 0.07, 0.34 + random() * 0.22, 0.17 + random() * 0.12);
    canopies.setColorAt(i, tint);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  g.add(trunks, canopies);
  return g;
}

/**
 * Grass tufts and wild flowers in the infield, concentrated where the pilot
 * can actually see them: alongside the apron and the taxiway.
 */
function buildMeadow(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'meadow';
  const random = rng(776611);

  const tufts: THREE.Matrix4[] = [];
  const flowers: { m: THREE.Matrix4; colour: THREE.Color }[] = [];
  const palette = [0xf2e35d, 0xe8e4dc, 0xd9738f, 0xbf9ad6, 0xe8a13c].map(
    (c) => new THREE.Color(c),
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // The visible infield: the verges beside the apron, the strip of grass
  // between the apron and taxiway A that sits right in front of the nose, and
  // the band beyond A. Sampling a big rectangle and rejecting most of it
  // wasted nearly everything on ground behind the aeroplane, so the bands are
  // sampled directly instead.
  const BANDS = [
    // x-span, z-span, share of the budget
    { x: 70, zNear: 24, zFar: -30, weight: 0.3 }, // either side of the ramp
    { x: 90, zNear: -22, zFar: -62, weight: 0.34 }, // straight off the nose
    { x: 150, zNear: -80, zFar: -150, weight: 0.22 }, // beyond taxiway A
    { x: 240, zNear: -150, zFar: -232, weight: 0.14 }, // out toward the runway
  ] as const;
  const BUDGET = 9000;

  for (const band of BANDS) {
    const count = Math.round(BUDGET * band.weight);
    for (let i = 0; i < count; i++) {
      const x = (random() * 2 - 1) * band.x;
      const z = band.zNear + random() * (band.zFar - band.zNear);
      if (occupied(x, z)) continue;
      // Thin out with distance, where individual tufts stop being legible
      // and only cost fill rate.
      if (random() > 1.15 - Math.hypot(x, z) / 260) continue;

      const height = 0.28 + fbm(x * 0.01, z * 0.01, { frequency: 6, octaves: 2, seed: 5 }) * 0.5;
      q.setFromAxisAngle(up, random() * Math.PI);
      pos.set(x, GROUND_Y + height * 0.5, z);
      scl.set(0.7 + random() * 0.6, height, 0.7 + random() * 0.6);
      tufts.push(m.clone().compose(pos, q, scl));

      if (random() < 0.11) {
        pos.set(x + (random() - 0.5) * 0.6, GROUND_Y + height * 0.95, z + (random() - 0.5) * 0.6);
        scl.setScalar(0.06 + random() * 0.055);
        flowers.push({
          m: m.clone().compose(pos, q, scl),
          colour: palette[Math.floor(random() * palette.length)] ?? palette[0]!,
        });
      }
    }
  }

  if (tufts.length > 0) {
    // A tuft is three crossed blades: cheap, and reads as grass in the round.
    const blade = new THREE.ConeGeometry(0.09, 1, 3, 1, true);
    const tuftColour = new THREE.Color();
    const tuftMesh = new THREE.InstancedMesh(
      blade,
      new THREE.MeshStandardMaterial({
        color: 0x4c6b2f,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      tufts.length,
    );
    tuftMesh.name = 'grass-tufts';
    tufts.forEach((mat, i) => {
      tuftMesh.setMatrixAt(i, mat);
      // Vary each tuft's tone so the verge looks grown rather than mown to
      // a single flat colour.
      tuftColour.setHSL(0.23 + random() * 0.06, 0.38 + random() * 0.2, 0.2 + random() * 0.14);
      tuftMesh.setColorAt(i, tuftColour);
    });
    tuftMesh.instanceMatrix.needsUpdate = true;
    if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true;
    g.add(tuftMesh);
  }

  if (flowers.length > 0) {
    const flowerMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      flowers.length,
    );
    flowerMesh.name = 'wild-flowers';
    flowers.forEach((f, i) => {
      flowerMesh.setMatrixAt(i, f.m);
      flowerMesh.setColorAt(i, f.colour);
    });
    flowerMesh.instanceMatrix.needsUpdate = true;
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
    g.add(flowerMesh);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/* Clouds                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fair-weather cumulus, as clusters of instanced puffs.
 *
 * Billboards would need their orientation rewritten every frame; solid puffs
 * need no per-frame work at all beyond the drift below, and from the ground
 * they read convincingly because you only ever see them from underneath.
 *
 * The thing that makes or breaks this is distance. A first attempt put the
 * base at 500 m and kept the field inside a 1 km disc, and the result looked
 * like white balloons hanging over the field — at that range a 100 m puff
 * subtends 12° and every facet shows. Cumulus bases sit above a kilometre,
 * and once the field is that high and runs out to the horizon the same
 * geometry reads as sky instead.
 */
function buildClouds(): { object: THREE.Object3D; update: (dt: number) => void } {
  const random = rng(31337);
  const group = new THREE.Group();
  group.name = 'clouds';

  const puffs: { m: THREE.Matrix4; haze: number }[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // Sampled on a disc by sqrt(u) so clusters spread evenly over the area
  // rather than bunching overhead. The field has to run a long way out: with
  // a base at 1250 m, a 4 km field bottoms out at 17° elevation and leaves a
  // conspicuous empty band of sky between the treeline and the lowest cloud.
  // Reaching 9 km puts the nearest-horizon clouds at 8°, which is what a real
  // cumulus day looks like from the ground.
  const FIELD_RADIUS = 9000;
  const BASE = 1250;

  for (let c = 0; c < 150; c++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * FIELD_RADIUS;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const cy = BASE + random() * 320;
    // Puffs overlap heavily — spread is deliberately smaller than the puff
    // radius, so a cluster fuses into one lumpy mass instead of reading as
    // a bunch of separate balls.
    const spread = 110 + random() * 130;
    const puffCount = 7 + Math.floor(random() * 6);
    // Aerial perspective: distant clouds wash toward the sky. The puffs opt
    // out of scene fog (it would black them out at this range), so the haze
    // is applied per instance as a tint instead.
    const haze = Math.min(1, radius / FIELD_RADIUS) ** 0.8;

    for (let p = 0; p < puffCount; p++) {
      const r = 95 + random() * 115;
      pos.set(
        cx + (random() * 2 - 1) * spread,
        cy + (random() * 2 - 1) * 55,
        cz + (random() * 2 - 1) * spread,
      );
      axis.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      q.setFromAxisAngle(axis, random() * Math.PI);
      // Flattened, because cumulus grows wider than it is tall and a flat
      // base is most of what distinguishes a cloud from a sphere.
      scl.set(r, r * (0.42 + random() * 0.2), r);
      puffs.push({ m: m.clone().compose(pos, q, scl), haze });
    }
  }

  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      // Cumulus undersides are bright grey, not black. With a single sun and
      // a weak environment the shaded side of a puff goes almost to nothing
      // and the cloud turns into a lit sphere, so the shadowed side gets
      // lifted by hand.
      emissive: 0xa9bed6,
      emissiveIntensity: 0.5,
      // Clouds sit past the fog's far distance, so they have to opt out of it
      // or they would be tinted into the haze and vanish.
      fog: false,
    }),
    puffs.length,
  );
  mesh.name = 'cloud-puffs';
  const hazeTint = new THREE.Color();
  const SKY = new THREE.Color(0xc4d8ea);
  puffs.forEach((puff, i) => {
    mesh.setMatrixAt(i, puff.m);
    // Capped below full haze so the most distant clouds still read as cloud
    // rather than dissolving completely into the sky.
    hazeTint.set(0xffffff).lerp(SKY, puff.haze * 0.55);
    mesh.setColorAt(i, hazeTint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);

  return {
    object: group,
    update(dt: number) {
      // The field turns slowly about the observer rather than translating.
      // From the cockpit that reads as a steady drift downwind, and unlike a
      // translation it never has to wrap — so there is no jump, and no cloud
      // ever wanders outside the far plane. One matrix per frame.
      group.rotation.y += dt * 0.0016;
    },
  };
}
