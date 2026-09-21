import type { Simulation } from '../Simulation';

/**
 * Where the artificial horizon rests when its rotor has stopped, in degrees.
 *
 * A gyro that is not spinning has nothing holding its axis up, so it leans
 * over and stays there. It does not sag symmetrically to some neutral —
 * which is why an attitude indicator on a cold aeroplane shows a definite,
 * wrong attitude rather than a vague droop.
 */
const TOPPLED_PITCH = 14;
const TOPPLED_BANK = 22;

/**
 * Seconds for the horizon to erect at full rotor speed, and to topple again
 * once stopped.
 *
 * Erection is deliberately slower than spool-up. On a real aeroplane the
 * rotor is up to speed — the OFF flag gone — well before the horizon has
 * finished settling, and you watch the last few degrees come out over the
 * next minute while you are doing something else. Running both off one
 * number would lose exactly that.
 */
const ERECT_SECONDS = 15;
const TOPPLE_SECONDS = 90;

/**
 * What the suction regulator holds the system at, and the RPM by which the
 * pump can supply it.
 *
 * The pump is positive-displacement and geared to the engine, so its output
 * climbs with RPM — but only until the regulator starts bleeding off the
 * excess, which on a light single happens at around idle. That is why a 172
 * reads in the green sitting on the ramp at 650 RPM, and why the run-up
 * check is that suction *stays* in the green rather than that it gets there.
 *
 * Modelling it as a straight line from zero to the green at cruise RPM, as
 * this did, has a nasty consequence: at idle it never reaches the pressure
 * the gyros need, so the attitude indicator quietly refuses to erect after a
 * perfectly good start, and topples back again if it had.
 */
const SUCTION_REGULATED = 4.9;
const SUCTION_FULL_RPM = 600;

/**
 * Engine-driven vacuum pump and the gyros it spins.
 *
 * The electric turn coordinator spins up as soon as the master goes on; the
 * vacuum gyros wait for the engine. Watching that happen is one of the
 * clearest demonstrations of which instruments depend on which system.
 *
 * Spinning and being level are two different things, and the attitude
 * indicator is modelled as such: the rotor comes up to speed in well under a
 * minute, and the horizon then takes a further minute or so to finish
 * erecting — which is exactly the order you see it in the aeroplane.
 */
export class Vacuum {
  /** Suction in inches of mercury; the green arc is 4.6 to 5.4. */
  suction = 0;
  /** Spool state of the vacuum gyros, 0..1. */
  gyroSpool = 0;
  /** Spool state of the electric turn coordinator, 0..1. */
  turnCoordinatorSpool = 0;
  /**
   * How far the artificial horizon is from level, in degrees. Positive pitch
   * reads as a climb it is not in; positive bank as a right bank.
   */
  attitudePitchError = TOPPLED_PITCH;
  attitudeBankError = TOPPLED_BANK;

  /** True once the horizon is close enough to level to fly on. */
  get attitudeErect(): boolean {
    return Math.abs(this.attitudePitchError) < 1 && Math.abs(this.attitudeBankError) < 1;
  }

  reset(): void {
    this.suction = 0;
    this.gyroSpool = 0;
    this.turnCoordinatorSpool = 0;
    this.attitudePitchError = TOPPLED_PITCH;
    this.attitudeBankError = TOPPLED_BANK;
  }

  update(dt: number, sim: Simulation): void {
    const rpm = sim.engine.rpm;

    // Climbing with engine speed until the regulator takes over, which it
    // does by idle — not at cruise.
    const target =
      rpm < 250 ? 0 : Math.min(SUCTION_REGULATED, (rpm / SUCTION_FULL_RPM) * SUCTION_REGULATED);
    this.suction += (target - this.suction) * (1 - Math.exp(-dt * 1.6));

    const spinning = this.suction > 3.8 ? 1 : 0;
    // Up to speed in well under a minute, and much longer to run down.
    this.gyroSpool += (spinning - this.gyroSpool) * (1 - Math.exp(-dt / (spinning ? 12 : 60)));

    // A gyro erects because pendulous vanes under the rotor push its axis
    // back toward vertical, and they only do anything while it is turning.
    // So erection is scaled by rotor speed and stops dead when the rotor
    // does — a stopped gyro never finds level, however long you wait.
    const erect = 1 - Math.exp((-dt * this.gyroSpool) / ERECT_SECONDS);
    this.attitudePitchError -= this.attitudePitchError * erect;
    this.attitudeBankError -= this.attitudeBankError * erect;

    // And as it slows, there is less and less holding the axis up, so it
    // leans back over toward where a stopped gyro sits.
    const fall = 1 - Math.exp((-dt * (1 - this.gyroSpool)) / TOPPLE_SECONDS);
    this.attitudePitchError += (TOPPLED_PITCH - this.attitudePitchError) * fall;
    this.attitudeBankError += (TOPPLED_BANK - this.attitudeBankError) * fall;

    const electricOn =
      sim.electrical.busPowered &&
      sim.electrical.busVolts > 9 &&
      sim.controls.bool('brkTurnCoord');
    const tcTarget = electricOn ? 1 : 0;
    this.turnCoordinatorSpool +=
      (tcTarget - this.turnCoordinatorSpool) * (1 - Math.exp(-dt / (electricOn ? 3 : 20)));
  }
}
