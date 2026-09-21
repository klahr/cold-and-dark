import * as THREE from 'three';
import type {
  BreakerControl,
  ControlDef,
  KeyControl,
  PushPullControl,
  SelectorControl,
  ToggleControl,
  WheelControl,
} from '../aircraft/types';
import { MAT, hitProxyMaterial, knobMaterial } from './materials';
import { box, cylinder } from './geometry';
import { makeLabel } from './text';

export type HighlightMode = 'none' | 'hover' | 'guide';

export interface DragInfo {
  /** Pointer movement since the drag started, in CSS pixels. */
  dx: number;
  dy: number;
  /** Control value when the drag started. */
  startValue: number;
}

/**
 * A control's 3D representation plus its interaction behaviour. One of these
 * is created per `ControlDef`; the renderer never needs to know which
 * aircraft it is drawing.
 */
export interface ControlObject {
  readonly def: ControlDef;
  readonly object: THREE.Object3D;
  /** Meshes the pointer can hit. */
  readonly hitTargets: readonly THREE.Object3D[];
  /**
   * Decor that never moves — mounting plates, bushings, detent rings. The
   * rig lifts these out and bakes them into one mesh, because a hundred
   * controls each contributing a separate plate is a hundred draw calls.
   */
  readonly staticParts: readonly THREE.Mesh[];
  /** Where this control's placard belongs, in the control's own frame. */
  readonly placard: { text: string; x: number; y: number; size: number } | null;
  /** Poses the meshes for a value. Called whenever the value changes. */
  apply(value: number): void;
  setHighlight(mode: HighlightMode): void;
  /** Per-frame animation, currently just the guided-mode pulse. */
  tick(elapsed: number): void;
  /**
   * New value for a click, or null if clicking does nothing. `localX` is
   * where the pointer landed across the control, in its own local metres:
   * negative is the left-hand side. Rotaries use it as the direction to
   * turn, which is the only way the ignition key can be wound back to OFF.
   */
  click(current: number, localX: number): number | null;
  /** New value for a drag, or null if the control cannot be dragged. */
  drag(info: DragInfo): number | null;
  /** Value to snap back to on pointer release (the starter key). */
  release(current: number): number | null;
}

const HALO_COLOR = 0x5ec8ff;
const GUIDE_COLOR = 0xffc14d;

/** Pixels of drag for one full push-pull travel or one wheel sweep. */
const DRAG_FULL_TRAVEL_PX = 140;

/** Half-angle of a switch throw. Exaggerated for on-screen readability. */
const THROW = 0.6;

/** Pale tip on a paddle switch, so which way it is leaning is obvious. */
const TIP_MATERIAL = () => knobMaterial(0xd8dade);

export function createControlObject(def: ControlDef): ControlObject {
  switch (def.kind) {
    case 'toggle':
      return makeToggle(def);
    case 'pushPull':
      return makePushPull(def);
    case 'selector':
      return makeSelector(def);
    case 'key':
      return makeKey(def);
    case 'breaker':
      return makeBreaker(def);
    case 'wheel':
      return makeWheel(def);
  }
}

/* ------------------------------------------------------------------ */
/* Shared scaffolding                                                  */
/* ------------------------------------------------------------------ */

/**
 * Builds the root group, the placard text and the highlight halo that every
 * control shares, and returns a small kit the specific factories fill in.
 */
function baseObject(def: ControlDef, haloRadius: number, placardOffset: number) {
  const staticParts: THREE.Mesh[] = [];
  const root = new THREE.Group();
  root.name = `control:${def.id}`;
  const m = def.mount;
  root.position.set(m.x, m.y, m.z ?? 0);
  root.rotation.set(m.pitch ?? 0, m.yaw ?? 0, m.roll ?? 0, 'YXZ');

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(haloRadius, haloRadius * 1.22, 32),
    new THREE.MeshBasicMaterial({
      color: HALO_COLOR,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  halo.position.z = 0.0015;
  halo.renderOrder = 3;
  root.add(halo);

  // Panel placards are not built here. They are collected by the rig and
  // silkscreened onto the panel in a single pass, the way the real ones are
  // printed onto the panel rather than glued on individually.
  const placard = def.placard
    ? {
        text: def.placard,
        x: 0,
        y: def.placardAbove ? -placardOffset : placardOffset,
        size: def.placardSize ?? 0.0048,
      }
    : null;

  let mode: HighlightMode = 'none';
  const haloMat = halo.material as THREE.MeshBasicMaterial;

  return {
    root,
    staticParts,
    placard,
    setHighlight(next: HighlightMode) {
      mode = next;
      haloMat.color.setHex(next === 'guide' ? GUIDE_COLOR : HALO_COLOR);
      if (next === 'none') haloMat.opacity = 0;
      if (next === 'hover') haloMat.opacity = 0.5;
    },
    tick(elapsed: number) {
      if (mode === 'guide') {
        haloMat.opacity = 0.45 + 0.35 * Math.sin(elapsed * 5.0);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Toggle switches                                                     */
/* ------------------------------------------------------------------ */

function makeToggle(def: ToggleControl): ControlObject {
  const w = def.width ?? 0.016;
  const h = def.height ?? 0.026;
  const base = baseObject(def, Math.max(w, h) * 0.72, -h / 2 - 0.008);

  // Recessed mounting plate.
  base.staticParts.push(box(w + 0.006, h + 0.006, 0.003, MAT.bezel(), [0, 0, 0.0015]));

  const body = new THREE.Group();
  body.position.z = 0.003;
  base.root.add(body);

  const mat = def.color ? knobMaterial(def.color) : MAT.frame();
  if (def.style === 'rocker') {
    body.add(box(w, h, 0.007, mat, [0, 0, 0.0035]));
  } else {
    // Paddle: a stalk with a flat tip, like the 172 light switches. The
    // lever is deliberately long and the throw wide, because a scale-accurate
    // toggle rotating a few degrees toward the screen reads as not moving
    // at all from the pilot's seat.
    const stalk = cylinder(0.0024, 0.0032, h * 0.85, mat, 10);
    stalk.position.y = h * 0.42;
    body.add(stalk);
    const tip = box(w * 0.8, h * 0.3, 0.005, TIP_MATERIAL(), [0, h * 0.8, 0]);
    body.add(tip);
  }

  const hit = box(w + 0.008, h + 0.008, 0.012, hitProxyMaterial(), [0, 0, 0.006]);
  hit.visible = false;
  base.root.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      // Up and toward the pilot = on.
      body.rotation.x = value > 0.5 ? -THROW : THROW;
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: (current) => (current > 0.5 ? 0 : 1),
    drag: () => null,
    release: () => null,
  };
}

/* ------------------------------------------------------------------ */
/* Push-pull knobs                                                     */
/* ------------------------------------------------------------------ */

function makePushPull(def: PushPullControl): ControlObject {
  const r = def.knobRadius;
  const base = baseObject(def, r * 1.3, -r - 0.011);
  const mat = knobMaterial(def.color);

  // Guide bushing in the panel.
  const bushing = cylinder(r * 0.45, r * 0.5, 0.006, MAT.bezel(), 16);
  bushing.rotation.x = Math.PI / 2;
  bushing.position.z = 0.003;
  base.staticParts.push(bushing);

  // The shaft and knob move together along the panel normal.
  const carrier = new THREE.Group();
  base.root.add(carrier);

  // The shaft runs *back* from the knob, through the bushing and into the
  // panel. Built forward instead — spanning z = 0 to travel + 0.02 ahead of
  // the panel face — it left a bare metal stalk exposed even with the control
  // pushed fully in, so every push-pull knob appeared to float 4 to 6 cm off
  // the panel on a rod. Running it backwards means the shaft is swallowed by
  // the panel when the control is in, and pulling the knob out draws exactly
  // as much of it into view as the control has travel.
  const shaft = cylinder(r * 0.3, r * 0.3, def.travel + 0.02, MAT.frame(), 12);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -(def.travel + 0.02) / 2;
  carrier.add(shaft);

  const knob = new THREE.Group();
  carrier.add(knob);

  if (def.shape === 'tee') {
    // Carb heat and cabin controls use a T-handle.
    const stem = cylinder(r * 0.34, r * 0.34, r * 1.1, mat, 12);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = r * 0.55;
    knob.add(stem);
    const bar = cylinder(r * 0.34, r * 0.34, r * 2.4, mat, 12);
    bar.rotation.z = Math.PI / 2;
    bar.position.z = r * 1.1;
    knob.add(bar);
  } else if (def.shape === 'ring') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.28, 12, 24), mat);
    ring.position.z = r * 0.5;
    knob.add(ring);
  } else {
    const head = cylinder(r, r * 0.92, r * 0.85, mat, 24);
    head.rotation.x = Math.PI / 2;
    head.position.z = r * 0.55;
    knob.add(head);
    // Knurled collar for grip, and a lighter face so the knob reads as round.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, r * 0.1, 8, 24), mat);
    collar.position.z = r * 0.3;
    knob.add(collar);
  }

  const hit = cylinder(r * 1.45, r * 1.45, def.travel + r * 2, hitProxyMaterial(), 12);
  hit.rotation.x = Math.PI / 2;
  hit.position.z = (def.travel + r * 2) / 2;
  hit.visible = false;
  carrier.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      // value 1 = fully in, 0 = fully out (toward the pilot).
      carrier.position.z = (1 - value) * def.travel;
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: () => null,
    drag: (info) => {
      // Dragging down pulls the knob out, which matches the hand motion.
      return info.startValue - info.dy / DRAG_FULL_TRAVEL_PX;
    },
    release: () => null,
  };
}

/* ------------------------------------------------------------------ */
/* Rotary selectors                                                    */
/* ------------------------------------------------------------------ */

function rotaryHandle(def: SelectorControl): THREE.Group {
  const g = new THREE.Group();
  const r = def.radius;

  if (def.style === 'lever') {
    g.add(box(r * 0.5, r * 2.0, r * 0.5, MAT.frame(), [0, r * 0.7, r * 0.3]));
    return g;
  }

  const knob = cylinder(r * 0.8, r * 0.9, r * 0.7, MAT.frame(), 20);
  knob.rotation.x = Math.PI / 2;
  knob.position.z = r * 0.35;
  g.add(knob);

  // Pointer arm showing which detent is selected.
  const arm = box(r * 0.28, r * 1.5, r * 0.42, MAT.frame(), [0, r * 0.6, r * 0.55]);
  g.add(arm);
  const tip = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf2f2ee, toneMapped: false }),
  );
  tip.position.set(0, r * 1.15, r * 0.77);
  g.add(tip);

  return g;
}

function makeSelector(def: SelectorControl): ControlObject {
  const base = baseObject(def, def.radius * 1.5, -def.radius * 1.5 - 0.009);

  // Detent plate with a tick and a name at each position.
  const plate = cylinder(def.radius * 1.35, def.radius * 1.35, 0.004, MAT.bezel(), 28);
  plate.rotation.x = Math.PI / 2;
  plate.position.z = 0.002;
  base.staticParts.push(plate);

  def.positions.forEach((name, i) => {
    const angle = def.angles[i] ?? 0;
    const rad = def.radius * 1.85;
    const label = makeLabel(name, { size: 0.0046 });
    label.position.set(Math.sin(angle) * rad, Math.cos(angle) * rad, 0.0045);
    base.root.add(label);
  });


  const handle = rotaryHandle(def);
  handle.position.z = 0.004;
  base.root.add(handle);

  const hit = cylinder(def.radius * 1.5, def.radius * 1.5, 0.03, hitProxyMaterial(), 12);
  hit.rotation.x = Math.PI / 2;
  hit.position.z = 0.015;
  hit.visible = false;
  base.root.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      handle.rotation.z = -(def.angles[Math.round(value)] ?? 0);
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: (current, localX) => {
      const n = def.positions.length;
      const step = localX < 0 ? -1 : 1;
      return (Math.round(current) + step + n) % n;
    },
    drag: (info) => nearestDetent(def.angles, info),
    release: () => null,
  };
}

/* ------------------------------------------------------------------ */
/* Magneto / starter key                                               */
/* ------------------------------------------------------------------ */

function makeKey(def: KeyControl): ControlObject {
  const r = def.radius;
  const base = baseObject(def, r * 1.6, -r * 1.7 - 0.009);

  const plate = cylinder(r * 1.4, r * 1.4, 0.004, MAT.bezel(), 28);
  plate.rotation.x = Math.PI / 2;
  plate.position.z = 0.002;
  base.staticParts.push(plate);

  def.positions.forEach((name, i) => {
    const angle = def.angles[i] ?? 0;
    const rad = r * 1.95;
    const label = makeLabel(name, { size: 0.0044 });
    label.position.set(Math.sin(angle) * rad, Math.cos(angle) * rad, 0.0045);
    base.root.add(label);
  });

  const barrel = new THREE.Group();
  barrel.position.z = 0.004;
  base.root.add(barrel);

  const lock = cylinder(r * 0.62, r * 0.68, r * 0.55, MAT.frame(), 20);
  lock.rotation.x = Math.PI / 2;
  lock.position.z = r * 0.28;
  barrel.add(lock);

  // Key blade sticking out of the barrel.
  barrel.add(box(r * 0.22, r * 1.25, r * 0.06, MAT.frame(), [0, r * 0.62, r * 0.6]));
  barrel.add(box(r * 0.55, r * 0.7, r * 0.08, MAT.frame(), [0, r * 1.45, r * 0.6]));

  const hit = cylinder(r * 1.5, r * 1.5, 0.03, hitProxyMaterial(), 12);
  hit.rotation.x = Math.PI / 2;
  hit.position.z = 0.015;
  hit.visible = false;
  base.root.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      barrel.rotation.z = -(def.angles[Math.round(value)] ?? 0);
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: (current, localX) => {
      const step = localX < 0 ? -1 : 1;
      return Math.min(def.positions.length - 1, Math.max(0, Math.round(current) + step));
    },
    drag: (info) => nearestDetent(def.angles, info),
    // START is spring-loaded: let go of the key and it falls back to BOTH.
    release: (current) => (Math.round(current) === def.springFrom ? def.springTo : null),
  };
}

/**
 * Maps a circular drag onto the nearest detent. Horizontal drag is the
 * dominant axis so the gesture works the same for knobs anywhere on the panel.
 */
function nearestDetent(angles: readonly number[], info: DragInfo): number {
  const startAngle = angles[Math.round(info.startValue)] ?? 0;
  const delta = (info.dx - info.dy) / 90;
  const wanted = startAngle + delta;
  let best = 0;
  let bestDist = Infinity;
  angles.forEach((a, i) => {
    const d = Math.abs(a - wanted);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Circuit breakers                                                    */
/* ------------------------------------------------------------------ */

function makeBreaker(def: BreakerControl): ControlObject {
  const r = 0.0045;
  const base = baseObject(def, r * 1.8, -r * 2.4);

  const collar = cylinder(r * 1.25, r * 1.25, 0.0025, MAT.bezel(), 12);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.00125;
  base.staticParts.push(collar);

  const carrier = new THREE.Group();
  base.root.add(carrier);
  const cap = cylinder(r, r, 0.004, MAT.frame(), 14);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.004;
  carrier.add(cap);

  const hit = cylinder(r * 1.9, r * 1.9, 0.014, hitProxyMaterial(), 10);
  hit.rotation.x = Math.PI / 2;
  hit.position.z = 0.007;
  hit.visible = false;
  base.root.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      // A popped breaker stands proud of the panel by a few millimetres.
      carrier.position.z = value > 0.5 ? 0 : 0.005;
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: (current) => (current > 0.5 ? 0 : 1),
    drag: () => null,
    release: () => null,
  };
}

/* ------------------------------------------------------------------ */
/* Hand wheels (elevator trim)                                         */
/* ------------------------------------------------------------------ */

function makeWheel(def: WheelControl): ControlObject {
  const base = baseObject(def, def.radius * 1.15, -def.radius - 0.014);

  const wheel = new THREE.Group();
  base.root.add(wheel);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius, def.thickness, 10, 36),
    MAT.frame(),
  );
  rim.rotation.y = Math.PI / 2;
  wheel.add(rim);

  // Spokes so the rotation is visible.
  for (let i = 0; i < 6; i++) {
    const spoke = box(0.004, def.radius * 1.9, def.thickness * 1.1, MAT.frame());
    spoke.rotation.x = (i * Math.PI) / 6;
    wheel.add(spoke);
  }

  const hit = cylinder(def.radius * 1.1, def.radius * 1.1, def.thickness * 3, hitProxyMaterial(), 12);
  hit.rotation.z = Math.PI / 2;
  hit.visible = false;
  base.root.add(hit);

  return {
    def,
    object: base.root,
    hitTargets: [hit],
    staticParts: base.staticParts,
    placard: base.placard,
    apply(value) {
      wheel.rotation.x = (value - 0.5) * def.sweep;
    },
    setHighlight: base.setHighlight,
    tick: base.tick,
    click: () => null,
    drag: (info) => info.startValue + info.dy / DRAG_FULL_TRAVEL_PX,
    release: () => null,
  };
}
