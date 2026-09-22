import { describe, expect, it } from 'vitest';
import { ChecklistRunner } from '../src/sim/Checklist';
import { Simulation } from '../src/sim/Simulation';
import { C172N } from '../src/aircraft/c172n';
import { detent, setBreakers, STEP } from './helpers';

/**
 * The whole procedure, flown one item at a time.
 *
 * `checklist-actions.test.ts` catches a step that is already true on a cold
 * and dark aeroplane. This catches the other half of the same problem: a step
 * that becomes true as a *side effect* of an earlier one, and so ticks itself
 * the moment the list reaches it. Those cannot be seen by looking at the
 * aeroplane at reset — they only appear part way through, which is exactly
 * why they survive being read for.
 *
 * It also fails if a step cannot be satisfied at all, which is the worst
 * authoring mistake available: the list stops, and nothing on screen says
 * why.
 */

/** What a pilot does when the list asks for each item. */
const ACTIONS: Record<string, (sim: Simulation) => void> = {
  seats: (s) => s.controls.set('seatLatch', 1),
  belts: (s) => s.controls.set('seatbelt', 1),
  doors: (s) => s.controls.set('cabinDoor', 1),
  'brakes-set': (s) => s.controls.set('parkingBrake', 0),
  'fuel-both': (s) => s.controls.set('fuelSelector', detent(s, 'fuelSelector', 'BOTH')),
  'avionics-off': (s) => s.controls.set('avionicsMaster', 0),
  'breakers-in': (s) => setBreakers(s, true),

  'mixture-rich': (s) => s.controls.set('mixture', 1),
  'carb-heat-cold': (s) => s.controls.set('carbHeat', 1),
  'master-on': (s) => {
    s.controls.set('masterBattery', 1);
    s.controls.set('masterAlternator', 1);
  },
  'beacon-on': (s) => s.controls.set('beacon', 1),
  prime: (s) => {
    // Three full strokes: out, in, three times over.
    for (let i = 0; i < 3; i++) {
      s.controls.set('primer', 0);
      for (let t = 0; t < 12; t++) s.tick(STEP);
      s.controls.set('primer', 1);
      for (let t = 0; t < 12; t++) s.tick(STEP);
    }
  },
  // A quarter of an inch, at the small end of what the item accepts. Set it
  // near the top of that range and the engine settles inside the warm-up
  // window on its own, which would turn the next item into a formality.
  'throttle-crack': (s) => s.controls.set('throttle', 0.10),
  'prop-clear': (s) => {
    s.pilot.setHeadYaw(1.2);
    s.pilot.setHeadYaw(-1.2);
  },
  start: (s) => {
    s.controls.set('magKey', detent(s, 'magKey', 'START'));
    for (let t = 0; t < 60 * 3; t++) s.tick(STEP);
    s.controls.set('magKey', detent(s, 'magKey', 'BOTH'));
  },
  'warm-idle': (s) => s.controls.set('throttle', 0.175),
  'avionics-on': (s) => s.controls.set('avionicsMaster', 1),

  'shutdown-avionics': (s) => s.controls.set('avionicsMaster', 0),
  'shutdown-mixture': (s) => s.controls.set('mixture', 0),
  'shutdown-mags': (s) => s.controls.set('magKey', detent(s, 'magKey', 'OFF')),
  'shutdown-master': (s) => {
    s.controls.set('masterBattery', 0);
    s.controls.set('masterAlternator', 0);
  },
};

/**
 * Items that are honestly an observation rather than an action: you arrive
 * at them having already done the thing that makes them true, and the step
 * is there to make you look at the result.
 *
 * Every other item has to be false when the list reaches it.
 */
const OBSERVATIONS = new Set(['oil-pressure', 'ammeter-check', 'shutdown-throttle']);

describe('the whole checklist, one item at a time', () => {
  it('can be flown from cold and dark to shut down again', () => {
    const sim = new Simulation(C172N);
    const checklist = new ChecklistRunner(C172N.checklists, sim);
    const total = C172N.checklists.reduce((n, s) => n + s.items.length, 0);
    const visited: string[] = [];
    const freebies: string[] = [];

    for (let guard = 0; guard < total + 5 && !checklist.finished; guard++) {
      const item = checklist.position?.item;
      if (!item) break;
      visited.push(item.id);

      if (!OBSERVATIONS.has(item.id) && item.satisfied(sim)) {
        freebies.push(`${item.id} — "${item.callout}"`);
      }

      ACTIONS[item.id]?.(sim);

      let waited = 0;
      while (checklist.position?.item.id === item.id && waited < 45) {
        sim.tick(STEP);
        checklist.update(STEP);
        waited += STEP;
      }
      expect(waited, `stuck on "${item.callout}"`).toBeLessThan(45);
    }

    // No step was true before the pilot did it.
    expect(freebies).toEqual([]);
    // And the list ran all the way through, in order, exactly once each.
    expect(checklist.finished).toBe(true);
    expect(visited).toEqual(C172N.checklists.flatMap((s) => s.items.map((i) => i.id)));
  });

  it('leaves the aeroplane genuinely dead at the end', () => {
    const sim = new Simulation(C172N);
    const checklist = new ChecklistRunner(C172N.checklists, sim);

    for (let guard = 0; guard < 40 && !checklist.finished; guard++) {
      const item = checklist.position?.item;
      if (!item) break;
      ACTIONS[item.id]?.(sim);
      let waited = 0;
      while (checklist.position?.item.id === item.id && waited < 45) {
        sim.tick(STEP);
        checklist.update(STEP);
        waited += STEP;
      }
    }

    // The list ends the moment the master goes off; the propeller is still
    // windmilling down at that point, so give it the few seconds it takes.
    for (let t = 0; t < 60 * 6; t++) sim.tick(STEP);

    expect(sim.engine.isRunning).toBe(false);
    expect(sim.engine.rpm).toBe(0);
    expect(sim.electrical.busPowered).toBe(false);
    expect(sim.ignition.sparkStrength).toBe(0);
  });

  /**
   * A step about a row of identical controls still has to be able to point
   * at something, or it is the one item on the list where asking for help
   * does nothing at all.
   */
  it('points at whichever breaker is actually out', () => {
    const sim = new Simulation(C172N);
    const checklist = new ChecklistRunner(C172N.checklists, sim);
    const breakers = [...sim.controls.definitions()].filter((d) => d.kind === 'breaker');
    const popped = breakers.filter((d) => !sim.controls.bool(d.id));

    // The aeroplane is found with exactly one breaker out. More than one and
    // it is unserviceable rather than untidy; none and the scan is a
    // formality.
    expect(popped).toHaveLength(1);

    // Walk to the breaker step.
    for (let guard = 0; guard < 20 && checklist.position?.item.id !== 'breakers-in'; guard++) {
      const item = checklist.position?.item;
      if (!item) break;
      ACTIONS[item.id]?.(sim);
      let waited = 0;
      while (checklist.position?.item.id === item.id && waited < 45) {
        sim.tick(STEP);
        checklist.update(STEP);
        waited += STEP;
      }
    }

    expect(checklist.position?.item.id).toBe('breakers-in');
    expect(checklist.highlight).toBe(popped[0]?.id);

    // And once it is in, there is nothing left to point at.
    sim.controls.set(popped[0]!.id, 1);
    expect(checklist.highlight).toBeNull();
  });

  /**
   * An exception left behind for a step that has been renamed is an
   * exception that silently covers something else.
   */
  it('names only real items as observations', () => {
    const ids = new Set(C172N.checklists.flatMap((s) => s.items.map((i) => i.id)));
    for (const id of OBSERVATIONS) {
      expect(ids.has(id), `${id} is not on the checklist`).toBe(true);
    }
  });
});
