import * as THREE from 'three';
import type { ControlRig } from '../render/ControlRig';
import type { ControlState } from '../sim/ControlState';
import type { ControlObject } from '../render/ControlObject';
import type { SeatedCamera } from './SeatedCamera';

/** Movement beyond this many pixels turns a press into a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;

export interface PointerCallbacks {
  /** Fired when the hovered control changes; null when nothing is hovered. */
  onHover(control: ControlObject | null, screenX: number, screenY: number): void;
  /** Fired after any pilot-initiated value change, for audio and coaching. */
  onActuate(id: string, value: number): void;
}

/**
 * Routes pointer input either to a cockpit control or to the camera.
 *
 * All gestures are expressed in screen pixels and funnelled through the
 * `ControlObject` interface, so adding a VR controller later means feeding
 * this class a different pointer source rather than rewriting control logic.
 */
export class Pointer {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private active: ControlObject | null = null;
  private startX = 0;
  private startY = 0;
  private startValue = 0;
  private dragged = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly rig: ControlRig,
    private readonly controls: ControlState,
    private readonly view: SeatedCamera,
    private readonly callbacks: PointerCallbacks,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
  }

  private pick(clientX: number, clientY: number): { control: ControlObject; localX: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.rig.pickTargets], false);
    const first = hits[0];
    if (!first) return null;
    const control = this.rig.objectForMesh(first.object);
    if (!control) return null;
    const local = control.object.worldToLocal(first.point.clone());
    return { control, localX: local.x };
  }

  private onDown = (e: PointerEvent): void => {
    // Right button is always camera look, so a knob never traps the view.
    const hit = e.button === 2 ? null : this.pick(e.clientX, e.clientY);
    this.canvas.setPointerCapture(e.pointerId);

    if (!hit) {
      this.view.beginLook(e.clientX, e.clientY);
      this.canvas.classList.add('looking');
      return;
    }

    this.active = hit.control;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startValue = this.controls.num(hit.control.def.id);
    this.dragged = false;

    // Act on press, not release. This is what makes the spring-loaded
    // starter detent work: the key moves to START as the button goes down,
    // cranks for as long as it is held, and falls back to BOTH on release.
    const next = hit.control.click(this.startValue, hit.localX);
    if (next !== null) this.commit(hit.control, next);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active) {
      if (this.view.isLooking()) {
        this.view.look(e.clientX, e.clientY);
      } else {
        const hovered = this.pick(e.clientX, e.clientY)?.control ?? null;
        this.rig.setHovered(hovered?.def.id ?? null);
        this.canvas.classList.toggle('over-control', hovered !== null);
        this.callbacks.onHover(hovered, e.clientX, e.clientY);
      }
      return;
    }

    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    const next = this.active.drag({ dx, dy, startValue: this.startValue });
    if (next === null) return;
    this.dragged = true;
    this.commit(this.active, next);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    const control = this.active;
    this.active = null;
    this.view.endLook();
    this.canvas.classList.remove('looking');

    if (!control) return;

    const sprung = control.release(this.controls.num(control.def.id));
    if (sprung !== null) this.commit(control, sprung);
  };

  private onLeave = (): void => {
    if (this.active) return;
    this.rig.setHovered(null);
    this.canvas.classList.remove('over-control');
    this.callbacks.onHover(null, 0, 0);
  };

  private commit(control: ControlObject, value: number): void {
    const before = this.controls.num(control.def.id);
    this.controls.set(control.def.id, value);
    const after = this.controls.num(control.def.id);
    if (after !== before) this.callbacks.onActuate(control.def.id, after);
  }
}
