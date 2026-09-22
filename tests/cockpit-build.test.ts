import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft/registry';
import { Simulation } from '../src/sim/Simulation';
import { installCanvasStub } from './canvasStub';

installCanvasStub();

const { buildCockpit } = await import('../src/render/Cockpit');
const { ControlRig } = await import('../src/render/ControlRig');
const { InstrumentRig } = await import('../src/render/InstrumentRig');
const { cabinHalfWidthAt } = await import('../src/render/fuselage');

/**
 * Builds the cockpit for real, in node, against a stub canvas.
 *
 * The data tests check that a control is inside the panel outline; this
 * checks that the renderer can actually mount it. Those are different
 * failures: an instrument whose build function throws, a control whose id
 * appears twice, a mount frame nothing is parented to — all of them produce
 * a black screen rather than a wrong number, and none of them are visible in
 * a test that only reads the definition.
 */
describe('cockpit assembly', () => {
  for (const aircraft of AIRCRAFT) {
    describe(aircraft.id, () => {
      const shell = buildCockpit();
      const sim = new Simulation(aircraft);
      const controls = new ControlRig(aircraft, sim.controls, shell);
      const instruments = new InstrumentRig(aircraft, shell);

      it('mounts every control where the pointer can reach it', () => {
        for (const def of aircraft.controls) {
          const object = controls.objectFor(def.id);
          expect(object, def.id).toBeDefined();
          expect(object?.hitTargets.length, def.id).toBeGreaterThan(0);
        }
        expect(controls.pickTargets.length).toBeGreaterThanOrEqual(aircraft.controls.length);
      });

      it('drives every instrument without throwing', () => {
        instruments.update(sim, 1 / 60);
        sim.tick(1 / 60);
        instruments.update(sim, 1 / 60);
      });

      it('puts every control somewhere real inside the cabin', () => {
        shell.group.updateMatrixWorld(true);
        const world = new THREE.Vector3();
        for (const def of aircraft.controls) {
          controls.objectFor(def.id)?.object.getWorldPosition(world);
          expect(Number.isFinite(world.x + world.y + world.z), def.id).toBe(true);
          expect(world.y, def.id).toBeGreaterThan(-0.1);
          // Inside the hull, not out in the scenery. The allowance is for
          // the handful of fittings that sit against the lining by design.
          expect(
            cabinHalfWidthAt(world.z, Math.max(0.05, world.y)),
            `${def.id} at (${world.x.toFixed(2)}, ${world.y.toFixed(2)}, ${world.z.toFixed(2)})`,
          ).toBeGreaterThan(Math.abs(world.x) - 0.02);
        }
      });

      it('leaves the control wheels fadeable', () => {
        expect(shell.yokes.length).toBe(2);
        expect(shell.yokeMaterial).toBeDefined();
      });
    });
  }
});
