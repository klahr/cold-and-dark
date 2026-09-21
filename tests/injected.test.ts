import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { C172S } from '../src/aircraft/c172s';
import { AIRCRAFT } from '../src/aircraft/registry';
import { run, select } from './helpers';

function newS(): Simulation {
  return new Simulation(C172S);
}

/**
 * The fuel-injected start, which is a different procedure from the 172N's
 * and exercises the same shared engine model through different parameters.
 */
function prepareInjected(sim: Simulation, primeSeconds = 4): void {
  select(sim, 'fuelSelector', 'BOTH');
  sim.controls.set('parkingBrake', 0);
  sim.controls.set('throttle', 0.15);
  sim.controls.set('masterBattery', 1);
  sim.controls.set('masterAlternator', 1);
  sim.controls.set('beacon', 1);
  select(sim, 'magKey', 'BOTH');
  run(sim, 0.2);

  // Prime: mixture rich, boost pump on for a few seconds, then both off.
  sim.controls.set('mixture', 1);
  sim.controls.set('fuelPump', 1);
  run(sim, primeSeconds);
  sim.controls.set('fuelPump', 0);
  sim.controls.set('mixture', 0);
  run(sim, 0.2);
}

describe('C172S fuel-injected start', () => {
  it('starts on the prime charge and keeps running once the mixture is advanced', () => {
    const sim = newS();
    prepareInjected(sim);

    select(sim, 'magKey', 'START');
    run(sim, 2.5);
    expect(['catching', 'running']).toContain(sim.engine.state);

    // Advance the mixture as it fires, then release the key.
    sim.controls.set('mixture', 1);
    run(sim, 0.5);
    select(sim, 'magKey', 'BOTH');
    run(sim, 8);

    expect(sim.engine.state).toBe('running');
    expect(sim.engine.rpm).toBeGreaterThan(700);
    expect(sim.engine.oilPressure).toBeGreaterThan(
      C172S.systems.engine.oilPressureRedlineLow,
    );
  });

  it('dies a few seconds after catching if the mixture is left at idle cutoff', () => {
    const sim = newS();
    prepareInjected(sim);

    select(sim, 'magKey', 'START');
    run(sim, 2.5);
    expect(['catching', 'running']).toContain(sim.engine.state);

    // The classic fumble: let go of the key and forget the mixture.
    select(sim, 'magKey', 'BOTH');
    run(sim, 10);
    expect(sim.engine.isRunning).toBe(false);
  });

  it('will not prime with the mixture at idle cutoff', () => {
    const sim = newS();
    select(sim, 'fuelSelector', 'BOTH');
    sim.controls.set('masterBattery', 1);
    sim.controls.set('throttle', 0.15);
    select(sim, 'magKey', 'BOTH');
    // Pump on, but the mixture valve is shut, so nothing reaches the injectors.
    sim.controls.set('fuelPump', 1);
    run(sim, 6);

    expect(sim.fuel.primeCharge).toBe(0);

    select(sim, 'magKey', 'START');
    run(sim, 6);
    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('not-primed')).toBe(true);
  });

  it('floods when the boost pump is left running too long', () => {
    const sim = newS();
    prepareInjected(sim, 12);

    select(sim, 'magKey', 'START');
    run(sim, 6);
    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('flooded')).toBe(true);
  });

  it('has no primer or carburettor heat on the panel', () => {
    const sim = newS();
    expect(sim.controls.has('primer')).toBe(false);
    expect(sim.controls.has('carbHeat')).toBe(false);
    expect(sim.controls.has('fuelPump')).toBe(true);
  });
});

describe('aircraft registry', () => {
  it('gives every aircraft a unique id and a complete definition', () => {
    const ids = new Set<string>();
    for (const aircraft of AIRCRAFT) {
      expect(ids.has(aircraft.id)).toBe(false);
      ids.add(aircraft.id);
      expect(aircraft.controls.length).toBeGreaterThan(10);
      expect(aircraft.instruments.length).toBeGreaterThan(5);
      expect(aircraft.checklists.length).toBeGreaterThan(0);
    }
  });

  it('builds a working simulation for every registered aircraft', () => {
    for (const aircraft of AIRCRAFT) {
      const sim = new Simulation(aircraft);
      run(sim, 1);
      expect(sim.engine.rpm).toBe(0);
      expect(sim.electrical.busPowered).toBe(false);
      sim.reset();
    }
  });

  it('uses control ids the checklists can actually reference', () => {
    for (const aircraft of AIRCRAFT) {
      const sim = new Simulation(aircraft);
      for (const section of aircraft.checklists) {
        for (const item of section.items) {
          if (item.highlight) {
            expect(
              sim.controls.has(item.highlight),
              `${aircraft.id}/${item.id} highlights unknown control "${item.highlight}"`,
            ).toBe(true);
          }
          // Predicates must be safe to evaluate cold and dark.
          expect(() => item.satisfied(sim)).not.toThrow();
        }
      }
    }
  });
});
