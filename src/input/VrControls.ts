import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import type { ControlRig } from '../render/ControlRig';
import type { ControlObject } from '../render/ControlObject';
import type { ControlState } from '../sim/ControlState';

/**
 * Hand movement, in metres, equivalent to one full push-pull travel. This is
 * the VR counterpart of the mouse's pixels-per-travel constant.
 */
const HAND_TRAVEL_METRES = 0.14;
/** The mouse gesture layer expresses drags in pixels; keep the same scale. */
const PIXELS_PER_TRAVEL = 140;
/** Hand movement before a press becomes a drag. */
const DRAG_THRESHOLD_M = 0.008;

/**
 * How long a left hand has to be gone before the wrist board gives up on it.
 *
 * Controllers blink out briefly — a moment asleep, a tracking dropout — and
 * reacting instantly would send the board back to its kneeboard mounting
 * beside the panel and then return it, which reads as the checklist
 * vanishing. It stays put on the last known wrist across a short gap.
 */
const ANCHOR_GRACE_SECONDS = 1.5;

interface HandState {
  controller: THREE.XRTargetRaySpace;
  ray: THREE.Line;
  reticle: THREE.Mesh;
  active: ControlObject | null;
  startValue: number;
  startPoint: THREE.Vector3;
  dragged: boolean;
}

export interface VrControlsCallbacks {
  onActuate(id: string, value: number): void;
  /**
   * What to strap the wrist board to for the left hand: a controller's grip
   * space, or a tracked hand's wrist joint — or null when there is no left
   * hand at all. Handedness arrives on `connected`, which can fire well
   * after the session starts and again when a controller is put down or
   * picked up, and hand joints appear later still, so this is a
   * subscription rather than something to read once.
   */
  onLeftAnchorChanged(anchor: THREE.Object3D | null): void;
}

/**
 * Motion-controller interaction.
 *
 * Every gesture is funnelled through the same `ControlObject` interface the
 * mouse uses — click on press, drag while held, spring back on release — so
 * the ignition key behaves identically whether you are holding a mouse
 * button or a trigger, and no control logic is duplicated.
 */
export class VrControls {
  /** Per-pointer gesture state, one per input index. */
  private readonly pointers: HandState[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();

  /** Grip spaces by index, with whichever hand each has reported being in. */
  private readonly grips: THREE.Object3D[] = [];
  private readonly gripModels: THREE.Object3D[] = [];
  private readonly hands: THREE.XRHandSpace[] = [];
  private readonly handedness: (XRHandedness | null)[] = [null, null];
  /** True where the input source is a tracked hand rather than a controller. */
  private readonly tracked: boolean[] = [false, false];
  /**
   * Hands whose pointer ray and reticle are currently withheld — the hand
   * holding the wrist board, while it is being read.
   */
  private readonly suppressed: boolean[] = [false, false];
  /**
   * Hands whose controller or hand model is never drawn at all. The left one
   * carries the checklist board; a controller drawn through it is clutter,
   * and the board is the thing you are meant to be looking at.
   */
  private readonly modelHidden: boolean[] = [false, false];
  /** The joint-sphere model, kept apart from the hand space it hangs on. */
  private readonly handModelObjects: (THREE.Object3D | null)[] = [null, null];
  /** Last anchor published, so the wrist board is only re-parented on change. */
  private publishedAnchor: THREE.Object3D | null = null;
  private noLeftHandFor = 0;
  private readonly handModels = new XRHandModelFactory();

  constructor(
    renderer: THREE.WebGLRenderer,
    rig: THREE.Object3D,
    private controlRig: ControlRig,
    private controls: ControlState,
    private readonly callbacks: VrControlsCallbacks,
  ) {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const ray = buildRay();
      const reticle = buildReticle();
      controller.add(ray);
      rig.add(controller, reticle);

      const pointer: HandState = {
        controller,
        ray,
        reticle,
        active: null,
        startValue: 0,
        startPoint: new THREE.Vector3(),
        dragged: false,
      };
      // Pinching a tracked hand raises the same select events a trigger
      // does, so every gesture below works with hands with no extra code.
      controller.addEventListener('selectstart', () => this.onSelectStart(pointer));
      controller.addEventListener('selectend', () => this.onSelectEnd(pointer));
      this.pointers.push(pointer);

      const grip = renderer.xr.getControllerGrip(i);
      const gripModel = buildGrip();
      grip.add(gripModel);
      rig.add(grip);
      this.grips[i] = grip;
      this.gripModels[i] = gripModel;

      // Tracked hands. The joints are drawn as primitives rather than with
      // the mesh profile, which would fetch a model from a CDN — this
      // project generates everything at runtime and talks to no one.
      const trackedHand = renderer.xr.getHand(i);
      const handModel = this.handModels.createHandModel(trackedHand, 'spheres');
      trackedHand.add(handModel);
      rig.add(trackedHand);
      this.hands[i] = trackedHand;
      this.handModelObjects[i] = handModel;

      // Which hand a controller is in is not knowable from its index: it is
      // reported by the input source, and on some runtimes only once the
      // controller wakes up. Assuming index 0 is the left hand puts the
      // wrist board on the wrong arm for anyone it guesses wrong about.
      const index = i;
      controller.addEventListener('connected', (event) => {
        const data = (event as unknown as { data?: XRInputSource }).data;
        this.handedness[index] = data?.handedness ?? null;
        // `hand` is populated only for tracked hands; its presence is what
        // distinguishes them from a controller on the same input index.
        this.tracked[index] = data?.hand != null;
        this.modelHidden[index] = this.handedness[index] === 'left';
        this.refreshHandVisuals(index);
        this.publishLeftAnchor();
      });
      controller.addEventListener('disconnected', () => {
        this.handedness[index] = null;
        this.tracked[index] = false;
        this.modelHidden[index] = false;
        this.refreshHandVisuals(index);
        this.publishLeftAnchor();
      });
    }
  }

  /**
   * What to hang the wrist board on for the left hand.
   *
   * With a controller that is its grip space. With a tracked hand it is the
   * wrist joint, which is a better anchor anyway — but the joint objects do
   * not exist until the first frame that carries hand data, so this can go
   * from null to real some frames after `connected`. `update` re-checks.
   */
  get leftAnchor(): THREE.Object3D | null {
    const index = this.handedness.indexOf('left');
    if (index < 0) return null;
    if (this.tracked[index]) {
      const wrist = this.hands[index]?.joints['wrist'];
      // Fall through to the grip until the joint shows up.
      if (wrist) return wrist;
    }
    return this.grips[index] ?? null;
  }

  /**
   * Withholds a hand's pointer ray and reticle.
   *
   * Used while the wrist board is being read: the ray is drawn through
   * whatever is in front of it, so an unsuppressed one lies straight across
   * the text. The hand also stops picking while withheld — a pointer you
   * cannot see should not be able to reach into the cockpit and move a
   * switch.
   */
  setPointerSuppressed(hand: XRHandedness, suppressed: boolean): void {
    const index = this.handedness.indexOf(hand);
    if (index < 0 || this.suppressed[index] === suppressed) return;
    this.suppressed[index] = suppressed;
    this.refreshHandVisuals(index);
  }

  /**
   * A held controller, an empty hand, a hand whose model is never drawn and
   * a hand whose pointer is withheld are four different things.
   *
   * Only the *models* are ever hidden, never the hand space itself: the
   * wrist board hangs off a joint of that space, so hiding it takes the
   * board down too — which is exactly what used to happen the moment you
   * turned your wrist to read it.
   */
  private refreshHandVisuals(index: number): void {
    const noPointer = this.suppressed[index] === true;
    const noModel = this.modelHidden[index] === true;

    const grip = this.gripModels[index];
    if (grip) grip.visible = !noModel && !this.tracked[index];

    const handModel = this.handModelObjects[index];
    if (handModel) handModel.visible = !noModel;

    const pointer = this.pointers[index];
    if (pointer) {
      pointer.ray.visible = !noPointer;
      if (noPointer) pointer.reticle.visible = false;
    }
  }

  private publishLeftAnchor(): void {
    const anchor = this.leftAnchor;
    if (anchor === this.publishedAnchor) return;
    this.publishedAnchor = anchor;
    this.callbacks.onLeftAnchorChanged(anchor);
  }

  /** Points the rig at a new aircraft's controls after a swap. */
  retarget(controlRig: ControlRig, controls: ControlState): void {
    for (const hand of this.pointers) hand.active = null;
    this.controlRig = controlRig;
    this.controls = controls;
  }

  update(dt: number): void {
    // Hand joints materialise a frame or two into tracking, so the board's
    // anchor is re-checked rather than resolved once at connection — and a
    // hand that has just blinked out is given a moment to come back before
    // the board is moved off it.
    if (this.leftAnchor) {
      this.noLeftHandFor = 0;
      this.publishLeftAnchor();
    } else {
      this.noLeftHandFor += dt;
      if (this.noLeftHandFor > ANCHOR_GRACE_SECONDS) this.publishLeftAnchor();
    }

    for (const [index, hand] of this.pointers.entries()) {
      if (hand.active) {
        this.applyDrag(hand);
        continue;
      }
      if (this.suppressed[index]) {
        hand.reticle.visible = false;
        continue;
      }
      const picked = this.pick(hand);
      hand.reticle.visible = picked !== null;
      if (picked) hand.reticle.position.copy(this.hit);
      hand.ray.scale.z = picked ? this.origin.distanceTo(this.hit) : 1.2;
    }

    // Highlight whatever either hand is pointing at.
    const pointed = this.pointers.find((h) => h.reticle.visible && !h.active);
    this.controlRig.setHovered(pointed ? this.pickedIdFor(pointed) : null);
  }

  private pickedIdFor(hand: HandState): string | null {
    const control = this.pick(hand);
    return control?.def.id ?? null;
  }

  private pick(hand: HandState): ControlObject | null {
    this.tempMatrix.identity().extractRotation(hand.controller.matrixWorld);
    this.origin.setFromMatrixPosition(hand.controller.matrixWorld);
    this.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize();
    this.raycaster.set(this.origin, this.direction);
    this.raycaster.near = 0;
    this.raycaster.far = 2.5;

    const hits = this.raycaster.intersectObjects([...this.controlRig.pickTargets], false);
    const first = hits[0];
    if (!first) return null;
    this.hit.copy(first.point);
    return this.controlRig.objectForMesh(first.object) ?? null;
  }

  private onSelectStart(hand: HandState): void {
    // A withheld hand is reading the board, not reaching for a switch.
    if (this.suppressed[this.pointers.indexOf(hand)]) return;
    const control = this.pick(hand);
    if (!control) return;

    hand.active = control;
    hand.dragged = false;
    hand.startValue = this.controls.num(control.def.id);
    hand.startPoint.setFromMatrixPosition(hand.controller.matrixWorld);

    // Act on press, exactly as the mouse does, so the spring-loaded starter
    // detent cranks for as long as the trigger is held.
    const local = control.object.worldToLocal(this.hit.clone());
    const next = control.click(hand.startValue, local.x);
    if (next !== null) this.commit(control, next);
  }

  private applyDrag(hand: HandState): void {
    const control = hand.active;
    if (!control) return;

    this.origin.setFromMatrixPosition(hand.controller.matrixWorld);
    const dxWorld = this.origin.x - hand.startPoint.x;
    const dzWorld = this.origin.z - hand.startPoint.z;
    if (!hand.dragged && Math.hypot(dxWorld, dzWorld) < DRAG_THRESHOLD_M) return;

    // Drawing the hand back toward you pulls a knob out, and sliding it
    // sideways turns a rotary — the same motions as the real cockpit.
    const scale = PIXELS_PER_TRAVEL / HAND_TRAVEL_METRES;
    const next = control.drag({
      dx: dxWorld * scale,
      dy: dzWorld * scale,
      startValue: hand.startValue,
    });
    if (next === null) return;
    hand.dragged = true;
    this.commit(control, next);
  }

  private onSelectEnd(hand: HandState): void {
    const control = hand.active;
    hand.active = null;
    if (!control) return;
    const sprung = control.release(this.controls.num(control.def.id));
    if (sprung !== null) this.commit(control, sprung);
  }

  private commit(control: ControlObject, value: number): void {
    const before = this.controls.num(control.def.id);
    this.controls.set(control.def.id, value);
    const after = this.controls.num(control.def.id);
    if (after !== before) this.callbacks.onActuate(control.def.id, after);
  }
}

function buildRay(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(
    geometry,
    // Drawn through whatever is in the way. The wheel sits between the hand
    // and most of the panel, and a ray that stops dead at a part you can see
    // through reads as a ray that has hit something.
    new THREE.LineBasicMaterial({
      color: 0x5ec8ff,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
    }),
  );
  line.renderOrder = 950;
  line.scale.z = 1.2;
  return line;
}

function buildReticle(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 12, 8),
    // Same reasoning as the ray: the dot marking what you are about to
    // touch has to be visible even when the wheel is in front of it.
    new THREE.MeshBasicMaterial({
      color: 0x5ec8ff,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = 951;
  mesh.visible = false;
  return mesh;
}

/** A small stand-in for the controller itself, so hands feel embodied. */
function buildGrip(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.018, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6, metalness: 0.2 }),
  );
  mesh.rotation.x = -0.5;
  return mesh;
}
