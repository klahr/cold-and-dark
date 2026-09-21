import { Simulation } from '../src/sim/Simulation';
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
}

/**
 * Everything the POH asks for before the key is turned. Individual tests
 * override one item at a time to isolate a single mistake.
 */
export function prepareForStart(sim: Simulation, opts: SetupOptions = {}): void {
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
