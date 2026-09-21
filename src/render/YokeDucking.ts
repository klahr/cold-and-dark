import * as THREE from 'three';
import type { CockpitShell } from './Cockpit';

/**
 * Opacity the control wheel sits at normally.
 *
 * Not one. The wheel is squarely between the pilot and the bottom of the
 * panel, which is where the throttle quadrant, the switch row and the
 * ignition key all are. In the aeroplane you move your head; on a screen or
 * in a seated headset you cannot, so it stays slightly see-through the whole
 * time and you can work behind it without anything having to move.
 */
const BASE_OPACITY = 0.55;
/** Opacity it fades further to when it is hiding the control being asked for. */
const DUCKED_OPACITY = 0.18;
/** Seconds for the fade, so the yoke does not pop in and out. */
const FADE = 0.18;

/**
 * Fades the control wheel out when it stands between the pilot and the
 * control they are being asked to operate.
 *
 * In the real aeroplane the yoke genuinely does hide the bottom of the
 * panel, and you move your head. On a flat screen you cannot, and a switch
 * you cannot see reads as a switch that does not work — so the wheel gets
 * out of the way on its own and comes straight back.
 */
export class YokeDucking {
  private readonly raycaster = new THREE.Raycaster();
  private readonly meshes: THREE.Object3D[] = [];
  private readonly target = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private opacity = BASE_OPACITY;
  private wanted = BASE_OPACITY;
  private checkTimer = 0;

  constructor(private readonly shell: CockpitShell) {
    for (const yoke of shell.yokes) {
      yoke.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) this.meshes.push(obj);
      });
    }
    this.applyOpacity();
  }

  /**
   * @param focus World position of the control the pilot needs to see, or
   *              null if nothing in particular is being pointed at.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3 | null): void {
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.1;
      this.wanted = focus && this.occluded(camera, focus) ? DUCKED_OPACITY : BASE_OPACITY;
    }

    if (Math.abs(this.opacity - this.wanted) < 0.002) return;
    this.opacity += (this.wanted - this.opacity) * (1 - Math.exp(-dt / FADE));
    this.applyOpacity();
  }

  /**
   * The wheel never writes depth, because it is never fully opaque. That is
   * also what lets a pointer ray and the controls behind it read through it
   * rather than being clipped away by a wheel you can already see through.
   */
  private applyOpacity(): void {
    const mat = this.shell.yokeMaterial;
    mat.transparent = true;
    mat.opacity = this.opacity;
    mat.depthWrite = false;
    mat.needsUpdate = true;
  }

  private occluded(camera: THREE.Camera, focus: THREE.Vector3): boolean {
    camera.getWorldPosition(this.origin);
    this.target.copy(focus).sub(this.origin);
    const distance = this.target.length();
    if (distance < 1e-4) return false;
    this.target.multiplyScalar(1 / distance);

    this.raycaster.set(this.origin, this.target);
    this.raycaster.near = 0;
    this.raycaster.far = distance - 0.01;
    return this.raycaster.intersectObjects(this.meshes, false).length > 0;
  }
}
