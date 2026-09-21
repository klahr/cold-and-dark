import type { AircraftDefinition } from '../aircraft/types';
import { ControlState } from './ControlState';
import { FaultLog } from './Faults';
import { Electrical } from './systems/Electrical';
import { Engine } from './systems/Engine';
import { Fuel } from './systems/Fuel';
import { Ignition } from './systems/Ignition';
import { Vacuum } from './systems/Vacuum';
import { PilotState } from './PilotState';

/** Largest step the integrator will take, to keep behaviour frame-rate free. */
const MAX_SUBSTEP = 1 / 50;

/**
 * The whole aeroplane, with no rendering attached.
 *
 * Systems are updated in a fixed order so the data flow stays acyclic:
 * ignition decides whether the starter is asked for, electrical decides
 * whether it can actually turn, fuel decides whether there is anything to
 * burn, and only then does the engine make up its mind.
 */
export class Simulation {
  readonly controls: ControlState;
  readonly faults = new FaultLog();
  readonly electrical: Electrical;
  readonly ignition: Ignition;
  readonly fuel: Fuel;
  readonly engine: Engine;
  readonly vacuum = new Vacuum();
  /** What the pilot has physically looked at and done. */
  readonly pilot = new PilotState();

  /** Seconds since the last reset. */
  time = 0;

  constructor(readonly definition: AircraftDefinition) {
    const { engine, electrical, fuel } = definition.systems;
    this.controls = new ControlState(definition.controls);
    this.electrical = new Electrical(electrical);
    this.ignition = new Ignition(electrical);
    this.fuel = new Fuel(fuel, engine);
    this.engine = new Engine(engine);
  }

  /** Returns the aeroplane to cold and dark. */
  reset(): void {
    this.time = 0;
    this.controls.reset();
    this.faults.reset();
    this.electrical.reset();
    this.ignition.reset();
    this.fuel.reset();
    this.engine.reset();
    this.vacuum.reset();
    this.pilot.reset();
  }

  /**
   * Advances the simulation. Long frames are split into fixed substeps so
   * that a stutter cannot let the engine skip past a state transition.
   */
  tick(dt: number): void {
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0) {
      const step = Math.min(MAX_SUBSTEP, remaining);
      this.step(step);
      remaining -= step;
    }
  }

  private step(dt: number): void {
    this.time += dt;
    this.ignition.update(dt, this);
    this.electrical.update(dt, this);
    this.fuel.update(dt, this);
    this.engine.update(dt, this);
    this.vacuum.update(dt, this);
  }
}
