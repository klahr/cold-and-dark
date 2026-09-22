import type { ElectricalParams } from '../../aircraft/types';
import type { Simulation } from '../Simulation';

/**
 * Magnetos and the starter.
 *
 * Magnetos are self-powered, which is exactly why the key has to go to OFF
 * at shutdown even with the battery master off — a detail the checklist
 * layer explains when the pilot gets there.
 */
export class Ignition {
  /** 0 = no spark, 0.65 = one magneto, 1 = both. */
  sparkStrength = 0;
  /** Pilot is holding the key at START. */
  starterRequested = false;
  /** Starter is actually allowed to engage (not thermally locked out). */
  starterEngaged = false;
  /** Accumulated starter heat, in seconds of equivalent cranking. */
  starterHeat = 0;
  lockedOut = false;

  /** Seconds the starter has been engaged against an already-running engine. */
  private grindSeconds = 0;

  constructor(private readonly params: ElectricalParams) {}

  reset(): void {
    this.sparkStrength = 0;
    this.starterRequested = false;
    this.starterEngaged = false;
    this.starterHeat = 0;
    this.lockedOut = false;
    this.grindSeconds = 0;
  }

  update(dt: number, sim: Simulation): void {
    const key = sim.controls.has('magKey') ? sim.controls.pos('magKey') : 'OFF';

    switch (key) {
      case 'OFF':
        this.sparkStrength = 0;
        break;
      case 'L':
      case 'R':
        this.sparkStrength = 0.65;
        break;
      default:
        this.sparkStrength = 1;
        break;
    }

    this.starterRequested = key === 'START';

    // Thermal duty cycle. Cranking heats the starter; releasing the key lets
    // it cool, and it will not re-engage until it has cooled back down.
    // Uses last frame's bus state, which is close enough at 60 Hz and keeps
    // the update order acyclic.
    if (this.starterEngaged && sim.electrical.busPowered) {
      this.starterHeat += dt;
    } else {
      const coolRate = this.params.starterDutySeconds / this.params.starterCooldownSeconds;
      this.starterHeat = Math.max(0, this.starterHeat - dt * coolRate);
    }

    if (this.starterHeat >= this.params.starterDutySeconds) {
      this.lockedOut = true;
      sim.faults.raise('starter-hot', sim.time);
    } else if (this.lockedOut && this.starterHeat <= this.params.starterDutySeconds * 0.25) {
      this.lockedOut = false;
      sim.faults.clear('starter-hot');
    }

    this.starterEngaged = this.starterRequested && !this.lockedOut;

    // Every start passes briefly through this condition as the engine picks
    // up, so the pilot gets a moment to react before it counts as grinding.
    if (this.starterEngaged && sim.engine.rpm > 600) {
      this.grindSeconds += dt;
      if (this.grindSeconds > 1.2) sim.faults.raise('starter-while-running', sim.time);
    } else {
      this.grindSeconds = 0;
      // Cleared like every other condition in here. Left standing it was a
      // fault that could only ever be reported once a session, and — since a
      // live fault hands back the controls that put it right — it also left
      // the ignition key unlocked for the rest of the flight.
      sim.faults.clear('starter-while-running');
    }

    if (!this.sparkStrength && sim.electrical.busPowered) {
      // Only worth flagging once the pilot is actually trying to start.
      if (this.starterRequested) sim.faults.raise('mags-off', sim.time);
    } else {
      sim.faults.clear('mags-off');
    }
  }
}
