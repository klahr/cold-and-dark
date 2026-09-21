import * as THREE from 'three';
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
  private readonly hands: HandState[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();

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

      const hand: HandState = {
        controller,
        ray,
        reticle,
        active: null,
        startValue: 0,
        startPoint: new THREE.Vector3(),
        dragged: false,
      };
      controller.addEventListener('selectstart', () => this.onSelectStart(hand));
      controller.addEventListener('selectend', () => this.onSelectEnd(hand));
      this.hands.push(hand);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(buildGrip());
      rig.add(grip);
    }
  }

  /** Points the rig at a new aircraft's controls after a swap. */
  retarget(controlRig: ControlRig, controls: ControlState): void {
    for (const hand of this.hands) hand.active = null;
    this.controlRig = controlRig;
    this.controls = controls;
  }

  update(): void {
    for (const hand of this.hands) {
      if (hand.active) {
        this.applyDrag(hand);
        continue;
      }
      const picked = this.pick(hand);
      hand.reticle.visible = picked !== null;
      if (picked) hand.reticle.position.copy(this.hit);
      hand.ray.scale.z = picked ? this.origin.distanceTo(this.hit) : 1.2;
    }

    // Highlight whatever either hand is pointing at.
    const pointed = this.hands.find((h) => h.reticle.visible && !h.active);
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
    new THREE.LineBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.6 }),
  );
  line.scale.z = 1.2;
  return line;
}

function buildReticle(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x5ec8ff, toneMapped: false }),
  );
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
