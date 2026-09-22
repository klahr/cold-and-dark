import { Simulation } from '../src/sim/Simulation';
import type { ChecklistRunner } from '../src/sim/Checklist';
import { C172N } from '../src/aircraft/c172n';

export const STEP = 1 / 60;

export function newSim(): Simulation {
  return new Simulation(C172N);
}

/** Runs the simulation for a number of seconds at a fixed frame rate. */
export function run(sim: Simulation, seconds: number, step = STEP): void {
  const frames = Math.round(seconds / step);
  for (let i = 0; i < frames; i++) sim.tick(step);
}

/** Detent index of a named selector position. */
export function detent(sim: Simulation, id: string, name: string): number {
  const def = sim.controls.def(id);
  if (def.kind !== 'selector' && def.kind !== 'key') {
    throw new Error(`${id} is not a selector`);
  }
  const index = def.positions.indexOf(name);
  if (index < 0) throw new Error(`${id} has no position "${name}"`);
  return index;
}

export function select(sim: Simulation, id: string, name: string): void {
  sim.controls.set(id, detent(sim, id, name));
}

/** Gives the primer one complete out-and-in stroke. */
export function primeStroke(sim: Simulation, strokes = 1): void {
  for (let i = 0; i < strokes; i++) {
    sim.controls.set('primer', 0);
    run(sim, 0.2);
    sim.controls.set('primer', 1);
    run(sim, 0.2);
  }
}

/** Holds the key at START for a while, then lets it spring back to BOTH. */
export function crank(sim: Simulation, seconds: number): void {
  select(sim, 'magKey', 'START');
  run(sim, seconds);
  select(sim, 'magKey', 'BOTH');
  run(sim, 0.2);
}

export interface SetupOptions {
  fuel?: string;
  mixture?: number;
  throttle?: number;
  carbHeat?: number;
  strokes?: number;
  master?: boolean;
  /** Push every breaker in, as "CIRCUIT BREAKERS — CHECK IN" asks. */
  breakers?: boolean;
}

/** Every breaker on the panel, set or popped. */
export function setBreakers(sim: Simulation, inPlace: boolean): void {
  for (const def of sim.controls.definitions()) {
    if (def.kind === 'breaker') sim.controls.set(def.id, inPlace ? 1 : 0);
  }
}

/**
 * Everything the POH asks for before the key is turned. Individual tests
 * override one item at a time to isolate a single mistake.
 */
export function prepareForStart(sim: Simulation, opts: SetupOptions = {}): void {
  // The aeroplane is found with the alternator field breaker popped, so the
  // breaker scan is part of a by-the-book start.
  if (opts.breakers ?? true) setBreakers(sim, true);
  select(sim, 'fuelSelector', opts.fuel ?? 'BOTH');
  sim.controls.set('parkingBrake', 0);
  sim.controls.set('mixture', opts.mixture ?? 1);
  sim.controls.set('carbHeat', opts.carbHeat ?? 1);
  const master = opts.master ?? true;
  sim.controls.set('masterBattery', master ? 1 : 0);
  sim.controls.set('masterAlternator', master ? 1 : 0);
  sim.controls.set('beacon', 1);
  select(sim, 'magKey', 'BOTH');
  run(sim, 0.2);
  primeStroke(sim, opts.strokes ?? 3);
  sim.controls.set('throttle', opts.throttle ?? 0.15);
  run(sim, 0.2);
}

/** What a pilot does when the list asks for each item. */
export const CHECKLIST_ACTIONS: Record<string, (sim: Simulation) => void> = {
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
export const OBSERVATIONS = new Set(['oil-pressure', 'ammeter-check', 'shutdown-throttle']);

/**
 * Flies the list until `itemId` is the current step, doing what each earlier
 * step asks. The target item is left current and *not* yet done, so a test
 * can look at the aeroplane at the moment the pilot is being asked for it.
 */
export function advanceTo(sim: Simulation, checklist: ChecklistRunner, itemId: string): void {
  for (let guard = 0; guard < 40; guard++) {
    const item = checklist.position?.item;
    if (!item) throw new Error(`the checklist finished before reaching "${itemId}"`);
    if (item.id === itemId) return;

    CHECKLIST_ACTIONS[item.id]?.(sim);
    let waited = 0;
    while (checklist.position?.item.id === item.id && waited < 45) {
      sim.tick(STEP);
      checklist.update(STEP);
      waited += STEP;
    }
    if (waited >= 45) throw new Error(`stuck on "${item.id}" on the way to "${itemId}"`);
  }
  throw new Error(`never reached "${itemId}"`);
}
