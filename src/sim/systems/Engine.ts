import type { EngineParams } from '../../aircraft/types';
import type { Simulation } from '../Simulation';

export type EngineState = 'off' | 'cranking' | 'catching' | 'running' | 'dying';

/**
 * Lycoming O-320 state machine and dynamics.
 *
 * This is the heart of the trainer. Everything the pilot can get wrong
 * during a start expresses itself here: no spark, no fuel, no prime, too
 * much prime, a tired battery, or a throttle left wide open.
 */
export class Engine {
  state: EngineState = 'off';
  rpm = 0;
  oilPressure = 0;
  oilTempC = 15;
  cylinderHeadTempC = 15;
  /** How soaked the cylinders are, 0..1. Above 1 the engine will not fire. */
  floodLevel = 0;
  /** Seconds of continuous combustion since the engine last caught. */
  runningSeconds = 0;
  /** Engine hours counter, driven by RPM the way a real tach clock is. */
  tachHours = 0;
  /** Seconds the engine has been turning under the starter this attempt. */
  crankSeconds = 0;

  private fireTimer = 0;
  private readonly injected: boolean;

  constructor(private readonly params: EngineParams) {
    this.injected = params.induction === 'injected';
  }

  reset(): void {
    this.state = 'off';
    this.rpm = 0;
    this.oilPressure = 0;
    this.oilTempC = 15;
    this.cylinderHeadTempC = 15;
    this.floodLevel = 0;
    this.runningSeconds = 0;
    this.crankSeconds = 0;
    this.fireTimer = 0;
  }

  /** True once the engine is warm enough to start without priming. */
  get isWarm(): boolean {
    return this.cylinderHeadTempC > 60;
  }

  get isRunning(): boolean {
    return this.state === 'running';
  }

  update(dt: number, sim: Simulation): void {
    const { controls, electrical, ignition, fuel, faults } = sim;
    const p = this.params;

    const throttle = controls.num('throttle');
    const mixture = controls.num('mixture');
    const mixtureOpen = mixture > 0.15;

    // A fuel-injected engine is started with the mixture at idle cutoff and
    // fed by the prime already sitting in the injector lines. It will run on
    // that for a few seconds, which is exactly the window the pilot has to
    // advance the mixture. Get it wrong and the engine dies just after
    // catching — the classic hot-start fumble.
    const runningOnPrime = this.injected && !mixtureOpen && fuel.primeCharge > 0;
    const fuelToCylinders = mixtureOpen || runningOnPrime;
    const spark = ignition.sparkStrength > 0;
    const cranking = electrical.starterTorque > 0.05;

    this.updateFlooding(dt, sim, cranking, mixture, throttle);

    /* -------- what the engine is allowed to do this instant -------- */

    const primeNeeded = this.isWarm ? 0 : p.primeToCatch;
    const primed = fuel.primeCharge >= primeNeeded;
    const canFire =
      spark && fuelToCylinders && fuel.engineFuelAvailable && primed && this.floodLevel < 1;

    // Running on prime alone burns through it quickly.
    if (runningOnPrime && (this.state === 'catching' || this.state === 'running')) {
      fuel.primeCharge = Math.max(0, fuel.primeCharge - dt * p.primeToCatch * 0.5);
    }

    /* ---------------------- state machine -------------------------- */

    switch (this.state) {
      case 'off':
      case 'cranking':
        this.state = cranking ? 'cranking' : 'off';
        if (cranking) {
          this.crankSeconds += dt;
          if (canFire) {
            this.fireTimer += dt * ignition.sparkStrength;
            if (this.fireTimer >= p.catchSeconds) {
              this.state = 'catching';
              this.fireTimer = 0;
            }
          } else {
            this.fireTimer = Math.max(0, this.fireTimer - dt);
            this.diagnoseNoStart(sim, spark, mixtureOpen, primed);
          }
        } else {
          this.crankSeconds = 0;
          this.fireTimer = 0;
        }
        break;

      case 'catching':
        // Firing on a few cylinders and picking up. If the pilot kills the
        // fuel or spark now it will still die.
        if (!spark || !fuelToCylinders || !fuel.engineFuelAvailable) {
          this.state = 'dying';
        } else if (this.rpm > p.idleCutoffRpm * 1.4) {
          this.state = 'running';
          this.runningSeconds = 0;
        }
        break;

      case 'running':
        this.runningSeconds += dt;
        if (!spark) {
          faults.raise('mags-off', sim.time);
          this.state = 'dying';
        } else if (!fuelToCylinders) {
          this.state = 'dying';
        } else if (!fuel.engineFuelAvailable) {
          faults.raise('fuel-starvation', sim.time);
          this.state = 'dying';
        } else if (this.rpm < p.idleCutoffRpm) {
          this.state = 'dying';
        }
        break;

      case 'dying':
        this.runningSeconds = 0;
        if (cranking) this.state = 'cranking';
        else if (this.rpm < 20) this.state = 'off';
        break;
    }

    this.updateRpm(dt, sim, cranking, throttle, mixture);
    this.updateOilAndTemps(dt, sim);
  }

  /* ------------------------------------------------------------------ */

  private updateRpm(
    dt: number,
    sim: Simulation,
    cranking: boolean,
    throttle: number,
    mixture: number,
  ): void {
    const p = this.params;
    let target: number;
    let rate: number;

    if (this.state === 'running' || this.state === 'catching') {
      // Power falls off as the mixture is leaned toward cutoff.
      const mixtureFactor =
        this.injected && mixture <= 0.15 && sim.fuel.primeCharge > 0
          ? 0.75
          : Math.min(1, Math.max(0, (mixture - 0.15) / 0.45));
      const commanded = p.idleRpm + throttle * (p.maxRpm - p.idleRpm);
      target = commanded * (0.55 + 0.45 * mixtureFactor);
      rate = this.state === 'catching' ? 1.4 : 2.2;
    } else if (cranking) {
      target = p.crankRpm * sim.electrical.starterTorque;
      rate = 3.0;
    } else {
      target = 0;
      // A stopped prop windmills down over a couple of seconds.
      rate = 1.1;
    }

    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * rate));
    if (this.rpm < 12 && target === 0) this.rpm = 0;

    this.tachHours += (this.rpm / 2400) * (dt / 3600);

    if (
      this.state === 'catching' &&
      throttle > 0.35 &&
      !sim.faults.isActive('throttle-too-far')
    ) {
      sim.faults.raise('throttle-too-far', sim.time);
    }
  }

  private updateOilAndTemps(dt: number, sim: Simulation): void {
    const p = this.params;

    // Oil pressure follows RPM with a lag: the pump has to fill the galleries.
    // `oilPressureIdle` is the reading at 1000 RPM; the curve is anchored
    // there and clipped at the top of the gauge.
    const targetPressure =
      this.rpm < 300
        ? 0
        : Math.min(95, 20 + (this.rpm / 1000) * (p.oilPressureIdle - 20));
    const rise = this.rpm > 300 ? 0.9 : 2.2;
    this.oilPressure += (targetPressure - this.oilPressure) * (1 - Math.exp(-dt * rise));

    const burning = this.state === 'running' || this.state === 'catching';
    const targetOil = burning ? 82 : 15;
    const targetChT = burning ? 165 : 15;
    this.oilTempC += (targetOil - this.oilTempC) * (1 - Math.exp(-dt / (burning ? 240 : 900)));
    this.cylinderHeadTempC +=
      (targetChT - this.cylinderHeadTempC) * (1 - Math.exp(-dt / (burning ? 45 : 600)));

    // The 30-second rule. Oil pressure has to be in the green by then.
    if (
      this.state === 'running' &&
      this.runningSeconds > p.oilPressureTimeout &&
      this.oilPressure < p.oilPressureRedlineLow
    ) {
      sim.faults.raise('no-oil-pressure', sim.time);
    }
  }

  /**
   * Over-priming soaks the plugs. Clearing it is the real POH procedure:
   * mixture to idle cutoff, throttle wide open, and crank to pump the excess
   * fuel out through the exhaust.
   */
  private updateFlooding(
    dt: number,
    sim: Simulation,
    cranking: boolean,
    mixture: number,
    throttle: number,
  ): void {
    const p = this.params;

    // Flooding is not something that builds up while cranking — the moment
    // the eighth stroke goes in, the plugs are already wet. So the flood
    // level tracks the excess prime directly, and only the clearing
    // procedure (or a long wait) brings it back down.
    const excess = sim.fuel.primeCharge - p.primeToFlood;
    if (excess > 0) {
      const target = Math.min(2.5, excess / (p.primePerStroke * 1.5));
      this.floodLevel = Math.max(this.floodLevel, target);
    }

    const clearingProcedure = cranking && mixture < 0.15 && throttle > 0.85;
    if (clearingProcedure) {
      this.floodLevel = Math.max(0, this.floodLevel - dt * 0.45);
      sim.fuel.primeCharge = Math.max(0, sim.fuel.primeCharge - dt * p.primeToFlood * 0.6);
    } else if (!cranking) {
      // Fuel eventually evaporates off the plugs on its own, slowly.
      this.floodLevel = Math.max(0, this.floodLevel - dt * 0.012);
    }

    if (this.floodLevel >= 1) sim.faults.raise('flooded', sim.time);
    else if (this.floodLevel < 0.35) sim.faults.clear('flooded');
  }

  /** Explains why a cranking engine is not catching. */
  private diagnoseNoStart(
    sim: Simulation,
    spark: boolean,
    mixtureOpen: boolean,
    primed: boolean,
  ): void {
    // Wait a moment before complaining, so a normal start is not nagged at.
    if (this.crankSeconds < 1.5) return;

    if (!spark) {
      sim.faults.raise('mags-off', sim.time);
      return;
    }
    if (!sim.fuel.engineFuelAvailable) {
      sim.faults.raise('fuel-off', sim.time);
      return;
    }
    if (this.floodLevel >= 1) {
      sim.faults.raise('flooded', sim.time);
      return;
    }
    if (!primed) {
      sim.faults.raise('not-primed', sim.time);
      return;
    }
    // On an injected engine, cranking with the mixture shut is the correct
    // procedure, so a closed mixture is only a mistake on a carburettor.
    if (!mixtureOpen && !this.injected) sim.faults.raise('mixture-cutoff', sim.time);
  }
}
