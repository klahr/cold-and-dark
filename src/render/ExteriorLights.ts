import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';

/**
 * The exterior lights, as the pilot experiences them from the left seat.
 *
 * None of the lamps themselves are visible from inside a 172 — the beacon is
 * on the fin, the strobes and position lights are out on the wingtips. What
 * you see is their effect on the aeroplane around you: the cowl and the lift
 * struts going red once a second, the strobes cracking white, the landing
 * light throwing a pool onto the apron. Without that, flipping BCN changes
 * nothing you can perceive and the switch feels broken.
 *
 * The beacon and strobes are *not* real lights. three.js filters lights
 * against the camera's layers rather than per object, so there is no way to
 * let a point light wash the airframe without it also flooding the open-sided
 * cabin interior. Tinting the airframe's own material instead puts the flash
 * exactly on the surfaces it belongs on, costs nothing, and cannot leak.
 * The landing and taxi lights are genuine spotlights: they face forward and
 * down, so their cones never reach the cabin.
 */
export class ExteriorLights {
  private readonly landing: THREE.SpotLight;
  private readonly taxi: THREE.SpotLight;
  private readonly navBulbs: THREE.Mesh[] = [];
  private readonly strobeBulbs: THREE.Mesh[] = [];

  private readonly baseEmissive: THREE.Color;
  private readonly flashColour = new THREE.Color();
  private phase = 0;

  constructor(
    scene: THREE.Scene,
    private readonly airframe: THREE.MeshStandardMaterial,
    wingTipX = 5.1,
    wingY = 1.34,
    wingZ = -0.30,
  ) {
    const group = new THREE.Group();
    group.name = 'exterior-lights';

    this.baseEmissive = airframe.emissive.clone();

    this.landing = makeForwardSpot(0xfff4dc, 0.5, -1.2);
    this.taxi = makeForwardSpot(0xfff0cc, 0.72, -3.0);
    group.add(this.landing, this.landing.target, this.taxi, this.taxi.target);

    // Wingtip lamps: red to port, green to starboard, white strobe outboard.
    for (const side of [-1, 1] as const) {
      const navBulb = bulb(side < 0 ? 0xff2a18 : 0x25ff55, 0.06);
      navBulb.position.set(side * (wingTipX + 0.3), wingY, wingZ + 0.4);
      this.navBulbs.push(navBulb);
      group.add(navBulb);

      const strobeBulb = bulb(0xffffff, 0.085);
      strobeBulb.position.set(side * (wingTipX + 0.3), wingY, wingZ - 0.4);
      this.strobeBulbs.push(strobeBulb);
      group.add(strobeBulb);
    }

    scene.add(group);
  }

  update(dt: number, sim: Simulation): void {
    this.phase += dt;
    const c = sim.controls;
    const powered = sim.electrical.busPowered && sim.electrical.busVolts > 9;

    // Beacon: one flash a little under once a second.
    const beaconLit = powered && c.bool('beacon') && this.phase % 1.15 < 0.14;

    // Strobes: the characteristic double crack, then a long gap.
    const strobeCycle = this.phase % 1.45;
    const strobeLit =
      powered &&
      c.bool('strobes') &&
      (strobeCycle < 0.05 || (strobeCycle > 0.15 && strobeCycle < 0.2));

    // Wash the airframe. The strobe is white and much brighter, so it wins.
    this.flashColour.copy(this.baseEmissive);
    if (beaconLit) this.flashColour.setRGB(0.42, 0.04, 0.02);
    if (strobeLit) this.flashColour.setRGB(0.85, 0.87, 0.95);
    this.airframe.emissive.copy(this.flashColour);

    for (const b of this.strobeBulbs) b.visible = strobeLit;

    const navOn = powered && c.bool('navLights');
    for (const b of this.navBulbs) b.visible = navOn;

    this.landing.intensity = powered && c.bool('landingLight') ? 520 : 0;
    this.taxi.intensity = powered && c.bool('taxiLight') ? 240 : 0;
  }
}

/** A forward- and down-facing lamp on the nose, aimed at the apron. */
function makeForwardSpot(colour: number, angle: number, dropAt20m: number): THREE.SpotLight {
  const light = new THREE.SpotLight(colour, 0, 70, angle, 0.6, 1.1);
  light.position.set(0, 0.5, -2.05);
  light.target.position.set(0, 0.5 + dropAt20m, -20);
  return light;
}

/** A self-lit lamp glass, bright enough to read against daylight. */
function bulb(colour: number, radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 10, 8),
    new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
  );
  mesh.visible = false;
  return mesh;
}
