import * as THREE from 'three';

/**
 * A floating arrow that points at whatever control the checklist is asking
 * for next.
 *
 * This is the wayfinding half of guided mode. The halo on the control itself
 * says "this one" — but only once you are already looking at it, which is
 * exactly the moment you no longer need telling. The arrow is what gets you
 * there.
 *
 * It exists in the scene rather than in the DOM overlay, which is the whole
 * point: it works identically through a headset, where there is no overlay,
 * and it never moves the pilot's head. Driving someone's viewpoint for them
 * is unpleasant on a monitor and close to unacceptable in VR.
 *
 * Two states, blended rather than switched:
 *
 * - **At the control**, when it is comfortably in view: the arrow stands a
 *   little above the control and leans down at it, nodding.
 * - **Compass**, when it is not: the arrow parks in front of the pilot and
 *   tilts the way they need to turn. Turn that way and it flies to the
 *   control on its own, so the two states read as one object moving.
 */

/** Matches the guided halo in `ControlObject`, including its pulse rate. */
const GUIDE_COLOR = 0xffc14d;
const PULSE_RATE = 5.0;

/** Arrow proportions, metres. Sized to read at arm's length in the cabin. */
const HEAD_LENGTH = 0.038;
const HEAD_RADIUS = 0.018;
const SHAFT_LENGTH = 0.045;
const SHAFT_RADIUS = 0.006;

/**
 * Where the tip stands relative to the control, in metres: up the screen,
 * and a little out toward the pilot.
 *
 * Up the screen, and not along the line of sight. The offset used to be
 * purely toward the eye, which put the arrow squarely between the pilot and
 * the control — and since it is drawn over everything else in the cabin, on
 * purpose, it covered the one switch it exists to point out. Offsetting
 * across the view instead is the fix.
 *
 * *Up* is the side it comes from because the placard naming a control is
 * silkscreened underneath it, so an arrow below hides the word instead of
 * the switch. Sideways would sit on the neighbouring switch in the row; the
 * space above a control is the one reliably empty piece of panel around it.
 *
 * The small lift toward the pilot is not about covering anything — it keeps
 * the arrow off the face of the panel, so that in a headset, where the depth
 * is real, it reads as floating in front of the aeroplane rather than being
 * painted on it.
 */
const SIDE_OFFSET = 0.055;
const LIFT_OFFSET = 0.022;

/** How much of that offset the nod breathes in and out, as a fraction. */
const NOD = 0.22;

/** Where the arrow parks when the control is out of view. */
const COMPASS_DISTANCE = 0.5;
const COMPASS_DROP = 0.09;

/**
 * Angle off the view centre at which the control counts as lost, and the
 * narrower angle at which it counts as found again. The gap is hysteresis:
 * with a single threshold the arrow flaps between its two states every time
 * the pilot's head drifts across it.
 */
const LOST_ANGLE = 0.62;
const FOUND_ANGLE = 0.48;

export class GuideArrow {
  readonly object = new THREE.Group();

  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;

  private elapsed = 0;
  private lost = false;
  /** Eases in on a new target so the arrow grows into place. */
  private presence = 0;

  private readonly eye = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  /** The camera's up axis in world space, for standing clear of the control. */
  private readonly up = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly aim = new THREE.Object3D();

  constructor() {
    this.object.name = 'guide-arrow';
    this.object.visible = false;
    // Nothing in the cabin should be able to hide the one thing telling you
    // where to look: the fuel selector sits behind the throttle quadrant,
    // and an arrow honouring depth would be swallowed by it.
    this.object.renderOrder = 900;

    const shape = this.buildShape();

    this.bodyMat = new THREE.MeshBasicMaterial({
      color: GUIDE_COLOR,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowMat = new THREE.MeshBasicMaterial({
      color: GUIDE_COLOR,
      transparent: true,
      opacity: 0.2,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.BackSide,
    });
    this.materials.push(this.bodyMat, this.glowMat);

    const glow = new THREE.Mesh(shape, this.glowMat);
    glow.scale.setScalar(1.4);
    glow.renderOrder = 899;
    const body = new THREE.Mesh(shape, this.bodyMat);
    body.renderOrder = 900;
    this.object.add(glow, body);
  }

  /**
   * Points the arrow at a world position, or hides it when there is nothing
   * to point at. Call every frame with the camera actually being rendered —
   * in VR that is the headset's, so the compass state works there too.
   */
  update(dt: number, camera: THREE.Camera, target: THREE.Vector3 | null): void {
    this.elapsed += dt;

    if (!target) {
      this.presence = Math.max(0, this.presence - dt * 5);
      this.object.visible = this.presence > 0.01;
      if (this.object.visible) this.object.scale.setScalar(this.presence);
      return;
    }

    camera.getWorldPosition(this.eye);
    camera.getWorldDirection(this.forward);
    this.toTarget.copy(target).sub(this.eye);

    const distance = this.toTarget.length();
    if (distance < 1e-4) return;
    this.toTarget.divideScalar(distance);

    // Hysteresis, so a control sitting right on the boundary does not make
    // the arrow oscillate between hovering and parking.
    const offAxis = this.forward.angleTo(this.toTarget);
    this.lost = this.lost ? offAxis > FOUND_ANGLE : offAxis > LOST_ANGLE;

    if (this.lost) {
      // Park in front of the pilot, a little below eye line so it does not
      // sit on top of whatever they are trying to read.
      this.desired
        .copy(this.forward)
        .multiplyScalar(COMPASS_DISTANCE)
        .add(this.eye);
      this.desired.y -= COMPASS_DROP;
    } else {
      // Stand above the control and lean down at it, leaving the control
      // itself in the clear. The camera's own up axis rather than the
      // world's, so a tilted head in a headset tilts the arrow with it and
      // it stays above the control on screen instead of sliding round it.
      this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const breathe = 1 - NOD * (0.5 + 0.5 * Math.sin(this.elapsed * PULSE_RATE));
      this.desired
        .copy(target)
        .addScaledVector(this.up, SIDE_OFFSET * breathe)
        .addScaledVector(this.toTarget, -LIFT_OFFSET * breathe);
    }

    const first = this.presence < 0.01;
    this.presence = Math.min(1, this.presence + dt * 4);
    this.object.visible = true;
    this.object.scale.setScalar(this.presence);

    // Exponential smoothing: frame-rate independent, and it lets the two
    // states blend into one another instead of snapping.
    const alpha = first ? 1 : 1 - Math.exp(-dt * 12);
    this.object.position.lerp(this.desired, alpha);

    // `Object3D.lookAt` aims +Z at the target for anything that is not a
    // camera — it swaps the arguments internally — which is the axis the
    // arrow is built along.
    this.aim.position.copy(this.object.position);
    this.aim.lookAt(target);
    if (first) this.object.quaternion.copy(this.aim.quaternion);
    else this.object.quaternion.slerp(this.aim.quaternion, alpha);

    this.bodyMat.opacity = 0.75 + 0.25 * Math.sin(this.elapsed * PULSE_RATE);
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  /**
   * Head and shaft merged into one geometry, built along +Z with the tip at
   * the local origin — so the object's position is the point the arrow is
   * touching, and `lookAt` does the rest.
   *
   * +Z rather than the -Z a camera would use: `Object3D.lookAt` reverses its
   * arguments for everything that is not a camera or a light, so a plain
   * mesh ends up with +Z facing the target.
   */
  private buildShape(): THREE.BufferGeometry {
    const head = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 24);
    // A cone is built along +Y with its apex at +h/2; this turns it to face
    // +Z and slides the apex onto the origin.
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, -HEAD_LENGTH / 2);

    const shaft = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 16);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, -(HEAD_LENGTH + SHAFT_LENGTH / 2));

    const merged = mergeIntoOne([head, shaft]);
    head.dispose();
    shaft.dispose();
    this.geometries.push(merged);
    return merged;
  }
}

/**
 * Concatenates position/normal geometries. `BufferGeometryUtils.mergeGeometries`
 * would do this, but pulling in an examples module for two primitives costs
 * more than the twenty lines it saves.
 */
function mergeIntoOne(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const part of parts) {
    const indexed = part.index ? part.toNonIndexed() : part;
    const pos = indexed.getAttribute('position');
    const nor = indexed.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    if (indexed !== part) indexed.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}
