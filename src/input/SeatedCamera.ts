import * as THREE from 'three';
import { EYE } from '../render/frame';

export interface ViewPreset {
  id: string;
  label: string;
  /** Eye position; head movement is limited to leaning, never teleporting. */
  eye: readonly [number, number, number];
  /** Point the pilot is looking at. */
  target: readonly [number, number, number];
  fov: number;
}

const NEUTRAL_EYE = EYE;

export const VIEW_PRESETS: readonly ViewPreset[] = [
  {
    id: 'seated',
    label: 'Seated',
    eye: NEUTRAL_EYE,
    target: [-0.12, 0.86, -1.40],
    fov: 62,
  },
  {
    id: 'panel',
    label: 'Instrument panel',
    eye: [-0.25, 1.04, 0.05],
    target: [-0.24, 0.72, -0.60],
    fov: 54,
  },
  {
    id: 'engine',
    label: 'Engine gauges',
    eye: [-0.17, 1.02, 0.01],
    target: [-0.03, 0.72, -0.60],
    fov: 38,
  },
  {
    id: 'throttle',
    label: 'Throttle quadrant',
    eye: [-0.20, 1.02, 0.02],
    target: [0.02, 0.45, -0.62],
    fov: 42,
  },
  {
    id: 'switches',
    label: 'Switch panel & key',
    eye: [-0.26, 1.02, 0.04],
    target: [-0.36, 0.44, -0.62],
    fov: 42,
  },
  {
    id: 'cabin',
    label: 'Seat & doors',
    eye: [-0.24, 1.02, 0.14],
    target: [-0.34, 0.28, 0.02],
    fov: 62,
  },
  {
    id: 'fuel',
    label: 'Fuel selector',
    eye: [-0.24, 1.00, 0.12],
    target: [0.0, 0.16, -0.12],
    fov: 50,
  },
];

const YAW_LIMIT = 2.3;
// Far enough down to look at your own lap, which is where the seat latch,
// the belt buckle and the fuel selector all are.
const PITCH_MIN = -1.35;
const PITCH_MAX = 0.75;
const LOOK_SPEED = 0.0032;

function yawPitchTo(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
): { yaw: number; pitch: number } {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1)),
  };
}

/**
 * First-person camera locked to the pilot's seat. Drag to look around, scroll
 * to zoom, number keys to snap to a labelled area of the cockpit. The head
 * never leaves the seat — presets only lean and re-aim.
 */
export class SeatedCamera {
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private targetFov = 62;
  private readonly eye = new THREE.Vector3();
  private readonly targetEye = new THREE.Vector3();

  private looking = false;
  private lastX = 0;
  private lastY = 0;

  private activePreset = 0;

  constructor(aspect: number) {
    // The far plane has to reach the cloud field, which sits a kilometre up
    // and runs out to the horizon. Pushing it out is close to free here:
    // with a 1/z depth buffer, precision is set almost entirely by `near`,
    // so the sub-millimetre offsets the instrument stack relies on are
    // unaffected.
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.02, 20000);
    this.camera.rotation.order = 'YXZ';
    const first = VIEW_PRESETS[0];
    if (first) this.applyPreset(first, true);
  }

  get presetIndex(): number {
    return this.activePreset;
  }

  setPreset(index: number): void {
    const preset = VIEW_PRESETS[index];
    if (!preset) return;
    this.activePreset = index;
    this.applyPreset(preset, false);
  }

  setPresetById(id: string): void {
    const index = VIEW_PRESETS.findIndex((p) => p.id === id);
    if (index >= 0) this.setPreset(index);
  }

  private applyPreset(preset: ViewPreset, immediate: boolean): void {
    const { yaw, pitch } = yawPitchTo(preset.eye, preset.target);
    this.targetYaw = yaw;
    this.targetPitch = pitch;
    this.targetFov = preset.fov;
    this.targetEye.set(preset.eye[0], preset.eye[1], preset.eye[2]);
    if (immediate) {
      this.yaw = yaw;
      this.pitch = pitch;
      this.eye.copy(this.targetEye);
      this.camera.fov = preset.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Aims the head at a world point without moving out of the seat. */
  lookAtPoint(point: THREE.Vector3): void {
    const eye: readonly [number, number, number] = [
      this.targetEye.x,
      this.targetEye.y,
      this.targetEye.z,
    ];
    const { yaw, pitch } = yawPitchTo(eye, [point.x, point.y, point.z]);
    this.targetYaw = THREE.MathUtils.clamp(yaw, -YAW_LIMIT, YAW_LIMIT);
    this.targetPitch = THREE.MathUtils.clamp(pitch, PITCH_MIN, PITCH_MAX);
  }

  beginLook(x: number, y: number): void {
    this.looking = true;
    this.lastX = x;
    this.lastY = y;
  }

  isLooking(): boolean {
    return this.looking;
  }

  look(x: number, y: number): void {
    if (!this.looking) return;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    this.targetYaw = THREE.MathUtils.clamp(
      this.targetYaw - dx * LOOK_SPEED * (this.camera.fov / 62),
      -YAW_LIMIT,
      YAW_LIMIT,
    );
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch - dy * LOOK_SPEED * (this.camera.fov / 62),
      PITCH_MIN,
      PITCH_MAX,
    );
  }

  endLook(): void {
    this.looking = false;
  }

  zoom(deltaY: number): void {
    this.targetFov = THREE.MathUtils.clamp(this.targetFov + deltaY * 0.03, 22, 78);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 12);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.eye.lerp(this.targetEye, k);

    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    if (Math.abs(this.camera.fov - this.targetFov) > 0.01) {
      this.camera.fov += (this.targetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }
}
