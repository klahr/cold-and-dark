import type { Simulation } from '../Simulation';

/**
 * Engine-driven vacuum pump and the gyros it spins.
 *
 * The attitude indicator and heading indicator take the better part of a
 * minute to erect after a start, and the electric turn coordinator spins up
 * as soon as the master goes on. Watching that happen is one of the clearest
 * demonstrations of which instruments depend on which system.
 */
export class Vacuum {
  /** Suction in inches of mercury; the green arc is 4.6 to 5.4. */
  suction = 0;
  /** Spool state of the vacuum gyros, 0..1. */
  gyroSpool = 0;
  /** Spool state of the electric turn coordinator, 0..1. */
  turnCoordinatorSpool = 0;

  reset(): void {
    this.suction = 0;
    this.gyroSpool = 0;
    this.turnCoordinatorSpool = 0;
  }

  update(dt: number, sim: Simulation): void {
    const rpm = sim.engine.rpm;

    // The pump is geared to the engine and the regulator caps it at 5 inHg.
    const target = rpm < 300 ? 0 : Math.min(5.0, (rpm / 1000) * 4.6);
    this.suction += (target - this.suction) * (1 - Math.exp(-dt * 1.6));

    const spinning = this.suction > 3.8 ? 1 : 0;
    // Roughly 40 seconds to erect, and much longer to run down.
    this.gyroSpool += (spinning - this.gyroSpool) * (1 - Math.exp(-dt / (spinning ? 12 : 60)));

    const electricOn =
      sim.electrical.busPowered &&
      sim.electrical.busVolts > 9 &&
      sim.controls.bool('brkTurnCoord');
    const tcTarget = electricOn ? 1 : 0;
    this.turnCoordinatorSpool +=
      (tcTarget - this.turnCoordinatorSpool) * (1 - Math.exp(-dt / (electricOn ? 3 : 20)));
  }
}
