import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GuideArrow } from '../src/render/GuideArrow';

/**
 * The arrow is the only thing telling the pilot where to look, and in a
 * headset it is the *only* thing: there is no overlay to fall back on. Its
 * placement is pure arithmetic over the camera and a world point, so it is
 * checkable without a renderer, like the panel-fit test.
 */
function seatedCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.02, 100);
  camera.position.set(-0.25, 1.02, 0.05);
  camera.lookAt(-0.25, 0.9, -0.8);
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * Where the arrow's tip is aiming, in world space. +Z, because that is the
 * axis `Object3D.lookAt` points at the target for a non-camera object — the
 * opposite of the camera convention, and easy to get backwards.
 */
function aimOf(arrow: GuideArrow): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(arrow.object.quaternion).normalize();
}

describe('GuideArrow', () => {
  it('points its tip at the control', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();
    const target = new THREE.Vector3(-0.2, 0.78, -0.62);

    arrow.update(0.016, camera, target);

    const toTarget = target.clone().sub(arrow.object.position).normalize();
    expect(aimOf(arrow).angleTo(toTarget)).toBeLessThan(1e-3);
    arrow.dispose();
  });

  it('hovers a short way off the control, on the pilot side of it', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(-0.2, 0.78, -0.62);

    arrow.update(0.016, camera, target);
    const gap = arrow.object.position.distanceTo(target);

    // Close enough to read as attached to the control, never touching it.
    expect(gap).toBeGreaterThan(0.03);
    expect(gap).toBeLessThan(0.07);
    // Between the pilot and the control, so the control cannot occlude it.
    expect(arrow.object.position.distanceTo(eye)).toBeLessThan(eye.distanceTo(target));
    arrow.dispose();
  });

  it('nods toward the control rather than sitting still', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();
    const target = new THREE.Vector3(-0.2, 0.78, -0.62);

    const gaps = new Set<number>();
    for (let i = 0; i < 40; i++) {
      arrow.update(1 / 60, camera, target);
      gaps.add(Math.round(arrow.object.position.distanceTo(target) * 10000));
    }
    expect(gaps.size).toBeGreaterThan(5);
    arrow.dispose();
  });

  /**
   * The case the arrow exists for: a control behind you is exactly when the
   * halo on the control itself tells you nothing.
   */
  it('parks in front of the pilot when the control is out of view', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    // The fuel selector, down by the pilot's left ankle and well out of a
    // forward view.
    const behind = new THREE.Vector3(0.0, 0.16, 0.2);

    arrow.update(0.016, camera, behind);

    // Parked at arm's length in front, not stranded at the control.
    expect(arrow.object.position.distanceTo(eye)).toBeLessThan(0.6);
    expect(arrow.object.position.distanceTo(behind)).toBeGreaterThan(0.3);
    // ...and still pointing the way the pilot has to turn.
    const toTarget = behind.clone().sub(arrow.object.position).normalize();
    expect(aimOf(arrow).angleTo(toTarget)).toBeLessThan(1e-3);
    arrow.dispose();
  });

  it('flies to the control once the pilot turns toward it', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();
    const target = new THREE.Vector3(0.0, 0.16, 0.2);

    for (let i = 0; i < 10; i++) arrow.update(1 / 60, camera, target);
    const parked = arrow.object.position.distanceTo(target);

    // Look down and back at it, as the pilot would.
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    for (let i = 0; i < 120; i++) arrow.update(1 / 60, camera, target);

    expect(arrow.object.position.distanceTo(target)).toBeLessThan(parked);
    expect(arrow.object.position.distanceTo(target)).toBeLessThan(0.07);
    arrow.dispose();
  });

  it('goes away when there is nothing to point at', () => {
    const arrow = new GuideArrow();
    const camera = seatedCamera();

    for (let i = 0; i < 60; i++) {
      arrow.update(1 / 60, camera, new THREE.Vector3(-0.2, 0.78, -0.62));
    }
    expect(arrow.object.visible).toBe(true);

    for (let i = 0; i < 60; i++) arrow.update(1 / 60, camera, null);
    expect(arrow.object.visible).toBe(false);
    arrow.dispose();
  });
});
