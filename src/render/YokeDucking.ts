import * as THREE from 'three';
import type { CockpitShell } from './Cockpit';

/** Opacity the control wheel fades to when it is hiding something. */
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
  private opacity = 1;
  private wanted = 1;
  private checkTimer = 0;

  constructor(private readonly shell: CockpitShell) {
    for (const yoke of shell.yokes) {
      yoke.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) this.meshes.push(obj);
      });
    }
  }

  /**
   * @param focus World position of the control the pilot needs to see, or
   *              null if nothing in particular is being pointed at.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3 | null): void {
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.1;
      this.wanted = focus && this.occluded(camera, focus) ? DUCKED_OPACITY : 1;
    }

    if (Math.abs(this.opacity - this.wanted) < 0.002) return;
    this.opacity += (this.wanted - this.opacity) * (1 - Math.exp(-dt / FADE));

    const mat = this.shell.yokeMaterial;
    mat.transparent = this.opacity < 0.995;
    mat.opacity = this.opacity;
    mat.depthWrite = !mat.transparent;
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
