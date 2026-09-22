import * as THREE from 'three';
import type { ControlRig } from '../render/ControlRig';
import type { ControlState } from '../sim/ControlState';
import type { ControlObject } from '../render/ControlObject';
import type { SeatedCamera } from './SeatedCamera';

/** Movement beyond this many pixels turns a press into a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;

/** One finger's or one mouse button's grip on one control. */
interface Gesture {
  control: ControlObject;
  /** Where the press landed, in screen pixels. */
  startX: number;
  startY: number;
  /** Control value when the gesture started. */
  startValue: number;
  dragged: boolean;
}

export interface PointerCallbacks {
  /** Fired when the hovered control changes; null when nothing is hovered. */
  onHover(control: ControlObject | null, screenX: number, screenY: number): void;
  /** Fired after any pilot-initiated value change, for audio and coaching. */
  onActuate(id: string, value: number): void;
  /**
   * Whether the checklist is letting this control move at all. A step
   * already done stays done, and a step not yet reached cannot be done
   * early; see `ChecklistRunner.isLocked`.
   */
  canOperate(id: string): boolean;
  /** Fired when a press lands on a control the checklist is holding. */
  onBlocked(id: string): void;
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

  /**
   * One entry per pointer currently holding a control, keyed by `pointerId`.
   *
   * A map rather than a single `active`, because a touchscreen delivers more
   * than one pointer at a time and a single slot loses the ones underneath.
   * A second finger anywhere in the cockpit used to overwrite the first,
   * which meant the first control never got its `release` — and the one
   * control whose whole behaviour lives in `release` is the ignition key. It
   * stayed at START with the engine running, grinding the starter against
   * the ring gear indefinitely: exactly the thing the key springs back to
   * prevent.
   */
  private readonly gestures = new Map<number, Gesture>();

  /**
   * The pointer driving the camera, if any. Also one at a time: a second
   * finger must not take the view away from the one already swinging it.
   */
  private lookPointer: number | null = null;

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
    // A safety net for the release that must not be missed. Pointer capture
    // normally brings the `pointerup` back to the canvas wherever the finger
    // ends up, but capture can be refused or broken by the browser, and a
    // sprung control that never hears about the release stays sprung. These
    // fire second and find the gesture already gone in the ordinary case.
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.gestures.clear();
    this.lookPointer = null;
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
    // Capture keeps the rest of the gesture coming here even when the finger
    // wanders off the canvas. It is an optimisation, and one the browser is
    // entitled to refuse for a pointer it does not think we own — so losing
    // it must not take the press down with it.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // No capture; the window listeners in the constructor cover the rest.
    }

    if (!hit) {
      if (this.lookPointer === null) {
        this.lookPointer = e.pointerId;
        this.view.beginLook(e.clientX, e.clientY);
        this.canvas.classList.add('looking');
      }
      return;
    }

    // A held control does not move, and the press does not fall through to
    // the camera either: a switch that swings your view when you poke it
    // reads as the cockpit being broken rather than the switch being shut.
    if (!this.callbacks.canOperate(hit.control.def.id)) {
      this.callbacks.onBlocked(hit.control.def.id);
      return;
    }

    const startValue = this.controls.num(hit.control.def.id);
    this.gestures.set(e.pointerId, {
      control: hit.control,
      startX: e.clientX,
      startY: e.clientY,
      startValue,
      dragged: false,
    });

    // Act on press, not release. This is what makes the spring-loaded
    // starter detent work: the key moves to START as the button goes down,
    // cranks for as long as it is held, and falls back to BOTH on release.
    const next = hit.control.click(startValue, hit.localX);
    if (next !== null) this.commit(hit.control, next);
  };

  private onMove = (e: PointerEvent): void => {
    const gesture = this.gestures.get(e.pointerId);

    if (!gesture) {
      if (this.lookPointer === e.pointerId) {
        this.view.look(e.clientX, e.clientY);
        return;
      }
      // Somebody else is swinging the view or holding a knob. Re-reading
      // hover under their hand would fight whatever they are doing.
      if (this.lookPointer !== null || this.gestures.size > 0) return;
      const hovered = this.pick(e.clientX, e.clientY)?.control ?? null;
      this.rig.setHovered(hovered?.def.id ?? null);
      this.canvas.classList.toggle('over-control', hovered !== null);
      this.callbacks.onHover(hovered, e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (!gesture.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    const next = gesture.control.drag({ dx, dy, startValue: gesture.startValue });
    if (next === null) return;
    gesture.dragged = true;
    this.commit(gesture.control, next);
  };

  private onUp = (e: PointerEvent): void => {
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Already gone; nothing to release.
    }

    if (this.lookPointer === e.pointerId) {
      this.lookPointer = null;
      this.view.endLook();
      this.canvas.classList.remove('looking');
    }

    const gesture = this.gestures.get(e.pointerId);
    if (!gesture) return;
    this.gestures.delete(e.pointerId);

    // Forced past the lock: a sprung detent coming home is the control's own
    // physics, not the pilot moving it. The ignition key is the case — the
    // start step completes while the key is still held at START, so a lock
    // that also caught the release would leave the starter grinding against
    // a running engine with no way to let go.
    const control = gesture.control;
    const sprung = control.release(this.controls.num(control.def.id));
    if (sprung !== null) this.commit(control, sprung, true);
  };

  private onLeave = (): void => {
    if (this.gestures.size > 0) return;
    this.rig.setHovered(null);
    this.canvas.classList.remove('over-control');
    this.callbacks.onHover(null, 0, 0);
  };

  private commit(control: ControlObject, value: number, force = false): void {
    // The lock can land mid-gesture — the step completes as the knob passes
    // its threshold — so the drag is cut off where it stood rather than
    // being allowed to carry the control past it. Silently: they are already
    // being told the step is done.
    if (!force && !this.callbacks.canOperate(control.def.id)) return;
    const before = this.controls.num(control.def.id);
    this.controls.set(control.def.id, value);
    const after = this.controls.num(control.def.id);
    if (after !== before) this.callbacks.onActuate(control.def.id, after);
  }
}
