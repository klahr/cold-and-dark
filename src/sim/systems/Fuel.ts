import type { EngineParams, FuelParams } from '../../aircraft/types';
import type { Simulation } from '../Simulation';

/**
 * Tanks, the selector valve, the carburettor float bowl and the primer.
 *
 * Two details here carry most of the teaching weight:
 *
 *  - The float bowl holds a few seconds of fuel, so an engine started with
 *    the selector OFF catches, runs, and then quits. That is far more
 *    instructive than simply refusing to start.
 *  - The primer charge does not decay. Once the fuel is in the manifold it
 *    stays there until the engine burns it, so a pilot who primes and then
 *    takes four minutes to find the ignition key still has a primed engine.
 *    A real manifold does evaporate its prime over about half a minute, and
 *    modelling that made the aeroplane unstartable for the six-year-old this
 *    is built for: three strokes bought nineteen seconds, and the two steps
 *    between PRIME and START take a child far longer than that. The failure
 *    it produced taught nothing, because the thing that went wrong had
 *    scrolled off the screen by the time it did.
 */
export class Fuel {
  /** Litres remaining in each tank. */
  leftLitres = 0;
  rightLitres = 0;
  /** Seconds of running left in the carburettor float bowl. */
  bowlSeconds = 0;
  /** Raw fuel sitting in the induction manifold from the primer. */
  primeCharge = 0;
  /** Complete primer strokes given since the last reset. */
  primerStrokes = 0;
  /** Seconds of boost-pump priming given; the fuel-injected equivalent. */
  primeSeconds = 0;
  /** Fuel flow in US gallons per hour, as an injected engine displays it. */
  fuelFlowGph = 0;
  /** True while the selector is on a tank that still has fuel in it. */
  supplyAvailable = false;

  private primerArmed = false;

  constructor(
    private readonly params: FuelParams,
    private readonly engineParams: EngineParams,
  ) {
    this.reset();
  }

  reset(): void {
    this.leftLitres = this.params.tankLitres;
    this.rightLitres = this.params.tankLitres;
    this.bowlSeconds = this.params.carbBowlSeconds;
    this.primeCharge = 0;
    this.primerStrokes = 0;
    this.primeSeconds = 0;
    this.fuelFlowGph = 0;
    this.supplyAvailable = false;
    this.primerArmed = false;
  }

  /** True when the engine can actually draw fuel this instant. */
  get engineFuelAvailable(): boolean {
    return this.supplyAvailable || this.bowlSeconds > 0;
  }

  update(dt: number, sim: Simulation): void {
    const { controls, engine } = sim;

    const selector = controls.has('fuelSelector') ? controls.pos('fuelSelector') : 'BOTH';
    const left = selector === 'LEFT' || selector === 'BOTH';
    const right = selector === 'RIGHT' || selector === 'BOTH';
    const tankFuel =
      (left ? this.leftLitres : 0) + (right ? this.rightLitres : 0);
    this.supplyAvailable = selector !== 'OFF' && tankFuel > 0;

    if (this.engineParams.induction === 'injected') {
      this.updateBoostPumpPrime(dt, sim);
    } else {
      this.trackPrimer(controls.num('primer'));
    }

    // The bowl refills the moment the valve is open, and drains only when
    // the engine is drawing on it without a supply behind it.
    if (this.supplyAvailable) {
      this.bowlSeconds = Math.min(
        this.params.carbBowlSeconds,
        this.bowlSeconds + dt * 4,
      );
    } else if (engine.rpm > 200) {
      this.bowlSeconds = Math.max(0, this.bowlSeconds - dt);
    }

    // Burn from the tanks. Rough but monotonic: more RPM, more litres.
    if (engine.rpm > 400 && this.supplyAvailable) {
      const litresPerSecond = (0.9 + (engine.rpm / 2400) * 6.5) / 3600;
      const draw = litresPerSecond * dt;
      if (left && right) {
        this.leftLitres = Math.max(0, this.leftLitres - draw / 2);
        this.rightLitres = Math.max(0, this.rightLitres - draw / 2);
      } else if (left) {
        this.leftLitres = Math.max(0, this.leftLitres - draw);
      } else if (right) {
        this.rightLitres = Math.max(0, this.rightLitres - draw);
      }
    }

    // Only worth saying once the pilot is actually trying to use the engine.
    // A cold and dark aeroplane with the valve off is not a fault, it is a
    // checklist item they have not reached yet.
    const usingEngine = sim.ignition.starterRequested || engine.rpm > 100;
    if (selector === 'OFF' && usingEngine) sim.faults.raise('fuel-off', sim.time);
    else if (selector !== 'OFF') sim.faults.clear('fuel-off');

    if (!this.engineFuelAvailable && engine.rpm > 200) {
      sim.faults.raise('fuel-starvation', sim.time);
    } else if (this.supplyAvailable) {
      sim.faults.clear('fuel-starvation');
    }
  }

  /**
   * Fuel-injected priming: the electric boost pump pushes fuel through an
   * open mixture valve and into the injector lines. Fuel flow rises while it
   * runs, which is the cue the POH gives for how long to prime.
   */
  private updateBoostPumpPrime(dt: number, sim: Simulation): void {
    const pumpOn =
      sim.controls.has('fuelPump') &&
      sim.controls.bool('fuelPump') &&
      sim.electrical.busPowered &&
      sim.electrical.busVolts > 9;
    const mixtureOpen = sim.controls.num('mixture') > 0.5;
    const priming = pumpOn && mixtureOpen && this.supplyAvailable;

    if (priming) {
      // primePerStroke is read as "charge per second of pumping" here.
      this.primeCharge += this.engineParams.primePerStroke * dt;
      this.primeSeconds += dt;
    }

    const running = sim.engine.rpm > 400;
    this.fuelFlowGph = priming ? 10.5 : running ? 1.5 + (sim.engine.rpm / 2700) * 10 : 0;
  }

  /**
   * Counts primer strokes. A stroke is a full pull out followed by a full
   * push back in; half-hearted jiggling delivers nothing, which is also true
   * of the real pump.
   */
  private trackPrimer(value: number): void {
    if (value < 0.12) {
      this.primerArmed = true;
      return;
    }
    if (this.primerArmed && value > 0.9) {
      this.primerArmed = false;
      this.primerStrokes += 1;
      // A stroke only delivers fuel if the valve behind it is open.
      if (this.supplyAvailable) {
        this.primeCharge += this.engineParams.primePerStroke;
      }
    }
  }
}
