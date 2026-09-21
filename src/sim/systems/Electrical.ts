import type { ElectricalParams } from '../../aircraft/types';
import type { Simulation } from '../Simulation';

/** Continuous current draw of each switched load, in amps. */
const LOADS: Record<string, number> = {
  beacon: 2.5,
  navLights: 3.5,
  strobes: 4.5,
  landingLight: 8.0,
  taxiLight: 8.0,
  pitotHeat: 6.0,
  avionicsMaster: 5.0,
};

/** Instruments and indicators that draw as soon as the bus is alive. */
const STANDING_LOAD_AMPS = 2.0;

/**
 * Battery, alternator and the main bus.
 *
 * The important behaviour for a start trainer is voltage sag: cranking pulls
 * well over a hundred amps, the bus droops, and a battery that has already
 * been worked hard will not turn the starter fast enough to fire. That is
 * what makes "stop cranking and let it rest" a lesson rather than a rule.
 */
export class Electrical {
  /** State of charge, 0..1. */
  charge = 1;
  busVolts = 0;
  /** Net battery current: positive is charging, negative is discharging. */
  ammeter = 0;
  alternatorOnline = false;
  busPowered = false;
  lowVoltage = false;
  /** 0..1 scaling of starter torque from available voltage. */
  starterTorque = 0;
  totalLoadAmps = 0;

  constructor(private readonly params: ElectricalParams) {}

  reset(): void {
    this.charge = 1;
    this.busVolts = 0;
    this.ammeter = 0;
    this.alternatorOnline = false;
    this.busPowered = false;
    this.lowVoltage = false;
    this.starterTorque = 0;
    this.totalLoadAmps = 0;
  }

  /** Open-circuit terminal voltage of a lead-acid battery at this charge. */
  private openCircuitVolts(): number {
    // Flat below 10%, nominal 12.4 V at rest, a little above that when full.
    return 10.6 + 2.0 * Math.min(1, Math.max(0, this.charge));
  }

  update(dt: number, sim: Simulation): void {
    const { controls, ignition, engine } = sim;
    const batteryOn = controls.bool('masterBattery');
    const altSwitchOn = controls.bool('masterAlternator');

    // The alternator field is fed from the bus, so the battery master has to
    // be on as well, and it only produces once the engine is turning.
    this.alternatorOnline =
      altSwitchOn && batteryOn && controls.bool('brkAltField') && engine.rpm > 900;

    this.busPowered = batteryOn || this.alternatorOnline;

    let load = 0;
    if (this.busPowered) {
      load += STANDING_LOAD_AMPS;
      for (const [id, amps] of Object.entries(LOADS)) {
        if (controls.has(id) && controls.bool(id)) load += amps;
      }
    }

    const cranking = ignition.starterEngaged && this.busPowered;
    const starterAmps = cranking ? this.params.starterAmps : 0;
    this.totalLoadAmps = load + starterAmps;

    // Terminal voltage under load. 0.012 ohm is a typical internal
    // resistance for a healthy 12 V aircraft battery plus cabling.
    const ocv = this.openCircuitVolts();
    const sag = this.totalLoadAmps * 0.012;

    if (this.alternatorOnline) {
      this.busVolts = 13.9;
      const alternatorOutput = Math.min(
        this.params.alternatorAmps,
        this.totalLoadAmps + (1 - this.charge) * 30,
      );
      this.ammeter = alternatorOutput - this.totalLoadAmps;
    } else if (this.busPowered) {
      this.busVolts = Math.max(0, ocv - sag);
      this.ammeter = -this.totalLoadAmps;
    } else {
      this.busVolts = 0;
      this.ammeter = 0;
    }

    // Charge bookkeeping in amp-hours. A lead-acid battery delivers far less
    // than its nominal capacity at starter currents (the Peukert effect), so
    // a high draw is penalised. Calibrated so continuous cranking flattens
    // the battery in about a minute and a half — a handful of attempts.
    const drainPenalty =
      this.ammeter < 0 ? 1 + 5 * Math.min(1, Math.max(0, (this.totalLoadAmps - 30) / 130)) : 1;
    const deltaAh = (this.ammeter * drainPenalty * dt) / 3600;
    this.charge = Math.min(
      1,
      Math.max(0, this.charge + deltaAh / this.params.batteryCapacityAh),
    );

    // Starter torque collapses as the bus droops. Below about 9 V the motor
    // turns too slowly for the engine to fire.
    this.starterTorque = cranking
      ? Math.min(1, Math.max(0, (this.busVolts - 8.2) / (12.0 - 8.2)))
      : 0;

    this.lowVoltage = this.busPowered && !this.alternatorOnline && engine.rpm > 900;

    if (this.lowVoltage) sim.faults.raise('low-voltage', sim.time);
    else sim.faults.clear('low-voltage');

    if (this.charge < 0.12) sim.faults.raise('battery-flat', sim.time);
    else if (this.charge < 0.35) sim.faults.raise('battery-low', sim.time);
    else {
      sim.faults.clear('battery-low');
      sim.faults.clear('battery-flat');
    }
  }
}
