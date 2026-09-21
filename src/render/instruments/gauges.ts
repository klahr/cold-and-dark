import * as THREE from 'three';
import type { InstrumentContext, InstrumentHandle } from '../../aircraft/types';
import type { Simulation } from '../../sim/Simulation';
import { MAT } from '../materials';
import {
  customFace,
  customPlate,
  drawDialFace,
  valueToAngle,
  type DialSpec,
} from './dialFace';

/** Colours used across every instrument face. */
export const GAUGE = {
  green: '#3f9d55',
  yellow: '#d6a326',
  red: '#c0392b',
  white: '#e8eaed',
  blue: '#3f74b8',
} as const;

/** How quickly a needle chases its value. Real needles have inertia. */
const NEEDLE_LAG = 6.5;

/**
 * Builds an instrument case: a bezel ring, a face, and a glass cover.
 * Returns the group plus the face plane so callers can add needles on top.
 */
function buildCase(size: number, faceTexture: THREE.Texture) {
  const group = new THREE.Group();
  const r = size / 2;

  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 40, 1, true),
    MAT.bezel(),
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = 0.006;
  group.add(bezel);

  const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40), MAT.bezel());
  back.position.z = 0.0028;
  group.add(back);

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(r, 48),
    new THREE.MeshBasicMaterial({ map: faceTexture, toneMapped: false }),
  );
  face.position.z = 0.0042;
  group.add(face);

  const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), MAT.instrumentGlass());
  glass.position.z = 0.0125;
  glass.renderOrder = 4;
  group.add(glass);

  return { group, face, radius: r };
}

/**
 * A pointer: pointed tip, slim body, short counterweight behind the hub.
 * Drawn in the XY plane with the tip toward +Y, so a rotation of `a` about
 * Z with a negative sign puts it at dial angle `a`.
 */
function buildNeedle(radius: number, color: number, scale = 1): THREE.Mesh {
  const len = radius * 0.82 * scale;
  const w = radius * 0.035;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -radius * 0.18);
  shape.lineTo(-w * 0.8, len * 0.88);
  shape.lineTo(0, len);
  shape.lineTo(w * 0.8, len * 0.88);
  shape.lineTo(w, -radius * 0.18);
  shape.lineTo(w * 1.7, -radius * 0.2);
  shape.lineTo(-w * 1.7, -radius * 0.2);
  shape.closePath();

  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide }),
  );
  return mesh;
}

function buildHub(radius: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.075, 16),
    new THREE.MeshBasicMaterial({ color: 0x15171a, toneMapped: false }),
  );
}

export interface NeedleSpec {
  read: (sim: Simulation) => number;
  color?: number;
  /** Length relative to the default needle. */
  scale?: number;
  /** Skip the lag filter for needles that should track exactly. */
  instant?: boolean;
}

/**
 * The workhorse: a round dial with one or more needles driven by simulation
 * accessors. Everything from the airspeed indicator to the oil pressure
 * gauge is one of these plus a `DialSpec`.
 */
export function roundGauge(
  spec: DialSpec,
  needles: readonly NeedleSpec[],
  options: { overlay?: (group: THREE.Group, radius: number) => void } = {},
) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const { group, radius } = buildCase(ctx.size, drawDialFace(spec));

    const built = needles.map((n, i) => {
      const mesh = buildNeedle(radius, n.color ?? 0xf2f4f6, n.scale ?? 1);
      mesh.position.z = 0.0058 + i * 0.0008;
      group.add(mesh);
      return { spec: n, mesh, shown: valueToAngle(spec, spec.min) };
    });

    const hub = buildHub(radius);
    hub.position.z = 0.0084;
    group.add(hub);

    options.overlay?.(group, radius);

    return {
      object: group,
      update(sim, dt) {
        for (const n of built) {
          const target = valueToAngle(spec, n.spec.read(sim));
          n.shown = n.spec.instant
            ? target
            : n.shown + (target - n.shown) * (1 - Math.exp(-dt * NEEDLE_LAG));
          n.mesh.rotation.z = -n.shown;
        }
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* Attitude indicator                                                  */
/* ------------------------------------------------------------------ */

/**
 * Vacuum-driven artificial horizon. The aeroplane never moves in this
 * trainer, so the interesting behaviour is the erection: the horizon sags
 * and the OFF flag shows until the gyro is up to speed.
 */
export function attitudeIndicator() {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const r = ctx.size / 2;

    const bezelTex = customFace((c, size) => {
      const h = size / 2;
      c.clearRect(0, 0, size, size);
      // Bank scale around the top of the case.
      c.strokeStyle = '#e8eaed';
      c.fillStyle = '#e8eaed';
      c.lineWidth = size * 0.012;
      for (const deg of [-60, -30, -20, -10, 10, 20, 30, 60]) {
        const a = (deg * Math.PI) / 180 - Math.PI / 2;
        const inner = h * 0.78;
        const outer = Math.abs(deg) % 30 === 0 ? h * 0.94 : h * 0.88;
        c.beginPath();
        c.moveTo(h + Math.cos(a) * inner, h + Math.sin(a) * inner);
        c.lineTo(h + Math.cos(a) * outer, h + Math.sin(a) * outer);
        c.stroke();
      }
      // Sky pointer triangle at zero bank.
      c.beginPath();
      c.moveTo(h, h * 0.18);
      c.lineTo(h - size * 0.03, h * 0.30);
      c.lineTo(h + size * 0.03, h * 0.30);
      c.closePath();
      c.fill();
    });

    const group = new THREE.Group();
    const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40), MAT.bezel());
    back.position.z = 0.0028;
    group.add(back);

    // The horizon card: sky above, ground below, pitch ladder between.
    const cardTex = customFace((c, size) => {
      const h = size / 2;
      c.fillStyle = '#2f6fa8';
      c.fillRect(0, 0, size, h);
      c.fillStyle = '#6b4a2a';
      c.fillRect(0, h, size, h);
      c.strokeStyle = '#ffffff';
      c.lineWidth = size * 0.012;
      c.beginPath();
      c.moveTo(0, h);
      c.lineTo(size, h);
      c.stroke();
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `600 ${Math.round(size * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
      for (const deg of [-20, -10, 10, 20]) {
        const y = h - deg * (size * 0.016);
        const w = Math.abs(deg) === 10 ? size * 0.11 : size * 0.17;
        c.beginPath();
        c.moveTo(h - w, y);
        c.lineTo(h + w, y);
        c.stroke();
        c.fillText(String(Math.abs(deg)), h - w - size * 0.05, y);
      }
    });

    const cardHolder = new THREE.Group();
    cardHolder.position.z = 0.0038;
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2.0, r * 2.0),
      new THREE.MeshBasicMaterial({ map: cardTex, toneMapped: false }),
    );
    cardHolder.add(card);
    group.add(cardHolder);

    // Mask the card back down to a circle.
    const ringShape = new THREE.Shape();
    // Outer radius must clear the card's half-diagonal (1.414 r) but stay
    // inside the neighbouring instrument, which sits 2.34 r away.
    ringShape.absarc(0, 0, r * 1.45, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r * 0.985, 0, Math.PI * 2, true);
    ringShape.holes.push(hole);
    const mask = new THREE.Mesh(
      new THREE.ShapeGeometry(ringShape, 48),
      new THREE.MeshBasicMaterial({ color: 0x15171a, toneMapped: false }),
    );
    mask.position.z = 0.004;
    group.add(mask);

    const bezelPlate = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ map: bezelTex, transparent: true, toneMapped: false }),
    );
    bezelPlate.position.z = 0.005;
    group.add(bezelPlate);

    // Fixed miniature aeroplane.
    const planeMat = new THREE.MeshBasicMaterial({ color: 0xf5c518, toneMapped: false });
    const wingL = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.5, r * 0.055), planeMat);
    wingL.position.set(-r * 0.36, 0, 0.006);
    group.add(wingL);
    const wingR = wingL.clone();
    wingR.position.x = r * 0.36;
    group.add(wingR);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.045, 12), planeMat);
    dot.position.z = 0.006;
    group.add(dot);

    // OFF flag, shown while the gyro is below speed.
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 0.44, r * 0.2),
      new THREE.MeshBasicMaterial({
        map: customFace((c, size) => {
          c.fillStyle = '#b5322c';
          c.fillRect(0, 0, size, size);
          c.fillStyle = '#ffffff';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = `800 ${Math.round(size * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
          c.fillText('OFF', size / 2, size / 2);
        }, 128),
        toneMapped: false,
      }),
    );
    flag.position.set(-r * 0.36, r * 0.42, 0.007);
    group.add(flag);

    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), MAT.instrumentGlass());
    glass.position.z = 0.0125;
    group.add(glass);

    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 40, 1, true),
      MAT.bezel(),
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = 0.006;
    group.add(bezel);

    return {
      object: group,
      update(sim) {
        // The flag is about rotor speed, not about being level: it drops out
        // while the horizon still has degrees to go, which is what it does
        // in the aeroplane.
        flag.visible = sim.vacuum.gyroSpool < 0.9;

        // The pitch ladder above is drawn at `size * 0.016` texture pixels
        // per degree on a card `2r` across, so a degree is this far.
        const perDegree = r * 0.032;
        cardHolder.position.y = -sim.vacuum.attitudePitchError * perDegree;
        cardHolder.rotation.z = (sim.vacuum.attitudeBankError * Math.PI) / 180;
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* Heading indicator                                                   */
/* ------------------------------------------------------------------ */

export function headingIndicator(parkedHeading = 310) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const r = ctx.size / 2;
    const cardTex = customFace((c, size) => {
      const h = size / 2;
      c.fillStyle = '#111316';
      c.beginPath();
      c.arc(h, h, h, 0, Math.PI * 2);
      c.fill();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (let deg = 0; deg < 360; deg += 5) {
        const a = (deg * Math.PI) / 180 - Math.PI / 2;
        const major = deg % 30 === 0;
        c.strokeStyle = '#e8eaed';
        c.lineWidth = size * (major ? 0.014 : 0.008);
        const inner = h * (major ? 0.74 : 0.8);
        c.beginPath();
        c.moveTo(h + Math.cos(a) * inner, h + Math.sin(a) * inner);
        c.lineTo(h + Math.cos(a) * h * 0.88, h + Math.sin(a) * h * 0.88);
        c.stroke();
        if (major) {
          const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
          c.fillStyle = cardinal ? '#f5c518' : '#e8eaed';
          c.font = `700 ${Math.round(size * (cardinal ? 0.1 : 0.075))}px ui-sans-serif, system-ui, sans-serif`;
          const lr = h * 0.61;
          c.save();
          c.translate(h + Math.cos(a) * lr, h + Math.sin(a) * lr);
          c.rotate((deg * Math.PI) / 180);
          c.fillText(cardinal ?? String(deg / 10), 0, 0);
          c.restore();
        }
      }
    });

    const group = new THREE.Group();
    const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40), MAT.bezel());
    back.position.z = 0.0028;
    group.add(back);

    const card = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ map: cardTex, toneMapped: false }),
    );
    card.position.z = 0.0038;
    group.add(card);

    // Fixed aeroplane symbol and lubber line.
    const planeMat = new THREE.MeshBasicMaterial({ color: 0xf5f6f8, toneMapped: false });
    const fuselage = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.05, r * 0.5), planeMat);
    fuselage.position.z = 0.005;
    group.add(fuselage);
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.42, r * 0.05), planeMat);
    wing.position.z = 0.005;
    group.add(wing);
    const lubber = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.035, r * 0.16), planeMat);
    lubber.position.set(0, r * 0.88, 0.005);
    group.add(lubber);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 0.42, r * 0.18),
      new THREE.MeshBasicMaterial({ color: 0xb5322c, toneMapped: false }),
    );
    flag.position.set(r * 0.34, -r * 0.42, 0.006);
    group.add(flag);

    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), MAT.instrumentGlass());
    glass.position.z = 0.0125;
    group.add(glass);

    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 40, 1, true),
      MAT.bezel(),
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = 0.006;
    group.add(bezel);

    /**
     * A directional gyro has no north-seeking element of its own: it holds
     * whatever it was set to. Unpowered it simply sits still, and once it is
     * running it precesses a few degrees every quarter of an hour, which is
     * why the pilot resets it against the magnetic compass periodically.
     */
    const PRECESSION_DEG_PER_SECOND = 3 / (15 * 60);
    let precessionDeg = 0;

    return {
      object: group,
      update(sim, dt) {
        const spool = sim.vacuum.gyroSpool;
        flag.visible = spool < 0.9;
        if (spool > 0.9) precessionDeg += dt * PRECESSION_DEG_PER_SECOND;
        card.rotation.z = ((parkedHeading + precessionDeg) * Math.PI) / 180;
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* Turn coordinator                                                    */
/* ------------------------------------------------------------------ */

export function turnCoordinator() {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const r = ctx.size / 2;

    const faceTex = customFace((c, size) => {
      const h = size / 2;
      c.fillStyle = '#0e0f11';
      c.beginPath();
      c.arc(h, h, h, 0, Math.PI * 2);
      c.fill();

      // Standard-rate index marks.
      c.strokeStyle = '#e8eaed';
      c.lineWidth = size * 0.016;
      for (const deg of [-90, -70, 70, 90]) {
        const a = (deg * Math.PI) / 180 - Math.PI / 2;
        c.beginPath();
        c.moveTo(h + Math.cos(a) * h * 0.62, h + Math.sin(a) * h * 0.62);
        c.lineTo(h + Math.cos(a) * h * 0.86, h + Math.sin(a) * h * 0.86);
        c.stroke();
      }
      c.fillStyle = '#9aa0a8';
      c.textAlign = 'center';
      c.font = `700 ${Math.round(size * 0.055)}px ui-sans-serif, system-ui, sans-serif`;
      c.fillText('L', h - h * 0.55, h - h * 0.05);
      c.fillText('R', h + h * 0.55, h - h * 0.05);
      c.font = `600 ${Math.round(size * 0.045)}px ui-sans-serif, system-ui, sans-serif`;
      c.fillText('2 MIN TURN', h, h + h * 0.72);
      c.fillText('NO PITCH INFORMATION', h, h + h * 0.86);

      // Inclinometer tube.
      c.strokeStyle = '#2b2e33';
      c.lineWidth = size * 0.075;
      c.beginPath();
      c.arc(h, h - h * 0.72, h * 1.12, Math.PI * 0.34, Math.PI * 0.66);
      c.stroke();
      c.strokeStyle = '#e8eaed';
      c.lineWidth = size * 0.01;
      for (const dx of [-0.075, 0.075]) {
        c.beginPath();
        c.moveTo(h + h * dx, h + h * 0.33);
        c.lineTo(h + h * dx, h + h * 0.5);
        c.stroke();
      }
    });

    const group = new THREE.Group();
    const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40), MAT.bezel());
    back.position.z = 0.0028;
    group.add(back);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false }),
    );
    face.position.z = 0.0038;
    group.add(face);

    // Miniature aeroplane that banks with the rate of turn.
    const planeMat = new THREE.MeshBasicMaterial({ color: 0xf5f6f8, toneMapped: false });
    const plane = new THREE.Group();
    plane.position.z = 0.004;
    const wings = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.32, r * 0.06), planeMat);
    plane.add(wings);
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.06, r * 0.3), planeMat);
    fin.position.y = r * 0.15;
    plane.add(fin);
    const body = new THREE.Mesh(new THREE.CircleGeometry(r * 0.09, 14), planeMat);
    plane.add(body);
    group.add(plane);

    const ball = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.085, 16),
      new THREE.MeshBasicMaterial({ color: 0x1b1d20, toneMapped: false }),
    );
    ball.position.set(0, -r * 0.41, 0.005);
    group.add(ball);

    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), MAT.instrumentGlass());
    glass.position.z = 0.0125;
    group.add(glass);
    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 40, 1, true),
      MAT.bezel(),
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = 0.006;
    group.add(bezel);

    return {
      object: group,
      update(sim) {
        // Parked and level: the aeroplane symbol simply settles as the
        // electric gyro spins up.
        plane.rotation.z = (1 - sim.vacuum.turnCoordinatorSpool) * -0.22;
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* Engine cluster                                                      */
/* ------------------------------------------------------------------ */

export interface ClusterRow {
  label: string;
  read: (sim: Simulation) => number;
  min: number;
  max: number;
  /** Bands drawn along the scale, as value ranges. */
  bands?: readonly { from: number; to: number; color: string }[];
}

/**
 * The rectangular four-gauge cluster: oil temperature, oil pressure and the
 * two fuel quantity gauges, stacked as opposed pairs the way Cessna did it.
 */
export function engineCluster(rows: readonly ClusterRow[], aspect = 1.7) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const w = ctx.size;
    const h = ctx.size * aspect;
    const PX = 256;
    const pxH = Math.round(PX * aspect);

    const rowH = pxH / rows.length;

    const canvas = document.createElement('canvas');
    canvas.width = PX;
    canvas.height = pxH;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D canvas context unavailable');

    c.fillStyle = '#0e0f11';
    c.fillRect(0, 0, PX, pxH);

    const scaleX0 = PX * 0.34;
    const scaleX1 = PX * 0.93;

    rows.forEach((row, i) => {
      const cy = rowH * (i + 0.5);
      c.fillStyle = '#c9ccd1';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.font = `700 ${Math.round(rowH * 0.2)}px ui-sans-serif, system-ui, sans-serif`;
      c.fillText(row.label, PX * 0.05, cy);

      for (const band of row.bands ?? []) {
        const x0 = scaleX0 + ((band.from - row.min) / (row.max - row.min)) * (scaleX1 - scaleX0);
        const x1 = scaleX0 + ((band.to - row.min) / (row.max - row.min)) * (scaleX1 - scaleX0);
        c.fillStyle = band.color;
        c.fillRect(x0, cy + rowH * 0.13, x1 - x0, rowH * 0.1);
      }

      c.strokeStyle = '#e8eaed';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(scaleX0, cy + rowH * 0.1);
      c.lineTo(scaleX1, cy + rowH * 0.1);
      c.stroke();
      for (let t = 0; t <= 4; t++) {
        const x = scaleX0 + (t / 4) * (scaleX1 - scaleX0);
        c.beginPath();
        c.moveTo(x, cy + rowH * 0.1);
        c.lineTo(x, cy - rowH * 0.04);
        c.stroke();
      }

      if (i < rows.length - 1) {
        c.strokeStyle = '#2b2e33';
        c.beginPath();
        c.moveTo(0, rowH * (i + 1));
        c.lineTo(PX, rowH * (i + 1));
        c.stroke();
      }
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.07, h * 1.05, 0.012),
        MAT.bezel(),
      ).translateZ(0.006),
    );
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    plate.position.z = 0.0125;
    group.add(plate);

    // One sliding pointer per row.
    const pointerMat = new THREE.MeshBasicMaterial({ color: 0xf5f6f8, toneMapped: false });
    const pointers = rows.map((row, i) => {
      const shape = new THREE.Shape();
      const s = w * 0.035;
      shape.moveTo(0, 0);
      shape.lineTo(-s, -s * 1.5);
      shape.lineTo(s, -s * 1.5);
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), pointerMat);
      const rowHeightWorld = h / rows.length;
      mesh.position.set(0, h / 2 - rowHeightWorld * (i + 0.5) + rowHeightWorld * 0.1, 0.014);
      group.add(mesh);
      return { row, mesh, shown: row.min };
    });

    const x0 = -w / 2 + w * (scaleX0 / PX);
    const x1 = -w / 2 + w * (scaleX1 / PX);

    return {
      object: group,
      update(sim, dt) {
        for (const p of pointers) {
          const target = p.row.read(sim);
          p.shown += (target - p.shown) * (1 - Math.exp(-dt * NEEDLE_LAG));
          const t = THREE.MathUtils.clamp(
            (p.shown - p.row.min) / (p.row.max - p.row.min),
            0,
            1,
          );
          p.mesh.position.x = x0 + t * (x1 - x0);
        }
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* Annunciator                                                         */
/* ------------------------------------------------------------------ */

export function annunciator(
  text: string,
  color: string,
  read: (sim: Simulation) => boolean,
) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const w = ctx.size;
    const h = ctx.size * 0.38;
    const PX = 256;
    const pxH = Math.round(PX * (h / w));
    const lines = text.split('\n');
    const tex = customPlate(PX, pxH, (c, cw, ch) => {
      c.fillStyle = color;
      c.fillRect(0, 0, cw, ch);
      c.fillStyle = '#1b1004';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const lineH = ch / (lines.length + 0.6);
      c.font = `800 ${Math.round(lineH * 0.78)}px ui-sans-serif, system-ui, sans-serif`;
      lines.forEach((line, i) => {
        c.fillText(line, cw / 2, ch / 2 + (i - (lines.length - 1) / 2) * lineH);
      });
    });

    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(w * 1.1, h * 1.2, 0.006), MAT.bezel()));
    const lens = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }),
    );
    lens.position.z = 0.004;
    group.add(lens);

    const dark = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x14161a, toneMapped: false, opacity: 0.86, transparent: true }),
    );
    dark.position.z = 0.0045;
    group.add(dark);

    return {
      object: group,
      update(sim) {
        dark.visible = !read(sim);
      },
    };
  };
}


/* ------------------------------------------------------------------ */
/* Wet compass                                                         */
/* ------------------------------------------------------------------ */

/**
 * The magnetic compass, in its box on the windscreen centre post.
 *
 * It is the only heading reference that needs no power, no vacuum and no
 * spinning up — which is exactly why it is the thing the directional gyro
 * gets set against, and why it sits in the one place you cannot avoid
 * looking at. It is also the most recognisable object in a light aircraft
 * cockpit, and its absence was conspicuous.
 */
export function wetCompass(headingDeg: number) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const w = ctx.size;
    const h = w * 0.62;
    const depth = w * 0.52;

    const group = new THREE.Group();

    // Housing, open at the front where the card shows through.
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, depth),
      new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.55, metalness: 0.3 }),
    );
    shell.position.z = -depth / 2;
    group.add(shell);

    // The card is a drum: the numbers are painted round a cylinder floating
    // in fluid, so you read the far side of it through the window.
    const cardTex = customPlate(1024, 128, (c, cw, ch) => {
      c.fillStyle = '#131417';
      c.fillRect(0, 0, cw, ch);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (let deg = 0; deg < 360; deg += 5) {
        const x = (deg / 360) * cw;
        const major = deg % 30 === 0;
        c.strokeStyle = '#e8eaed';
        c.lineWidth = major ? 4 : 2;
        c.beginPath();
        c.moveTo(x, ch * 0.62);
        c.lineTo(x, ch * (major ? 0.82 : 0.74));
        c.stroke();
        if (major) {
          const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
          c.fillStyle = cardinal ? '#f2c94c' : '#e8eaed';
          c.font = `700 ${Math.round(ch * (cardinal ? 0.42 : 0.34))}px ui-sans-serif, system-ui, sans-serif`;
          c.fillText(cardinal ?? String(deg / 10), x, ch * 0.34);
        }
      }
    });
    cardTex.wrapS = THREE.RepeatWrapping;

    const drumR = h * 0.42;
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR, drumR, w * 0.86, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: cardTex, side: THREE.BackSide, toneMapped: false }),
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.z = -depth * 0.45;
    group.add(drum);

    // Lubber line down the middle of the window.
    const lubber = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.012, h * 0.5),
      new THREE.MeshBasicMaterial({ color: 0xd83b2c, toneMapped: false }),
    );
    lubber.position.z = 0.004;
    group.add(lubber);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.9, h * 0.62),
      MAT.instrumentGlass(),
    );
    glass.position.z = 0.006;
    group.add(glass);

    // Mounting bracket up to the windscreen post.
    const stalk = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.12, h * 0.55, depth * 0.3),
      new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.6, metalness: 0.35 }),
    );
    stalk.position.set(0, h * 0.7, -depth * 0.4);
    group.add(stalk);

    let shown = headingDeg;
    let velocity = 0;

    return {
      object: group,
      update(sim, dt) {
        // A liquid-damped card is never quite still: it swings when the
        // airframe is disturbed and settles slowly. Cranking shakes it.
        const shake = sim.engine.rpm > 100 && !sim.engine.isRunning ? 1.6 : 0;
        const idle = sim.engine.isRunning ? 0.25 : 0;
        const disturb = (Math.random() - 0.5) * (shake + idle);
        velocity += (headingDeg - shown) * dt * 2.4 + disturb * dt * 6;
        velocity *= Math.exp(-dt * 1.8);
        shown += velocity * dt;
        cardTex.offset.x = -shown / 360;
      },
    };
  };
}
