import { describe, expect, it } from 'vitest';
import { crank, newSim, prepareForStart, run } from './helpers';

/**
 * The artificial horizon, which is the one instrument that has to be *wrong*
 * before it is right.
 *
 * A vacuum gyro has nothing holding its axis up until it is spinning, so a
 * cold aeroplane shows a definite, wrong attitude — and erecting is a
 * separate, slower business than getting the rotor up to speed.
 */
describe('attitude indicator', () => {
  it('sits toppled on a cold and dark aeroplane', () => {
    const sim = newSim();
    expect(sim.vacuum.attitudeErect).toBe(false);
    expect(Math.abs(sim.vacuum.attitudeBankError)).toBeGreaterThan(10);
    expect(Math.abs(sim.vacuum.attitudePitchError)).toBeGreaterThan(5);
  });

  /** The thing that makes it a gyro and not a spirit level. */
  it('never finds level while the rotor is stopped', () => {
    const sim = newSim();
    const bank = sim.vacuum.attitudeBankError;
    run(sim, 300);
    expect(sim.vacuum.attitudeErect).toBe(false);
    expect(sim.vacuum.attitudeBankError).toBeCloseTo(bank, 1);
  });

  it('erects once the engine is driving the pump', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 10);
    sim.controls.set('throttle', 0.175);

    run(sim, 150);
    expect(sim.vacuum.attitudeErect).toBe(true);
  });

  /**
   * The realism worth having: the OFF flag drops out well before the horizon
   * has finished settling, so you watch the last few degrees come out while
   * you are busy with something else. One shared number would lose that.
   */
  it('comes up to speed well before it finishes erecting', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 10);
    sim.controls.set('throttle', 0.175);

    let upToSpeedAt: number | null = null;
    let erectAt: number | null = null;
    for (let t = 0; t < 300; t += 1) {
      run(sim, 1);
      if (upToSpeedAt === null && sim.vacuum.gyroSpool > 0.9) upToSpeedAt = t;
      if (erectAt === null && sim.vacuum.attitudeErect) erectAt = t;
    }

    expect(upToSpeedAt).not.toBeNull();
    expect(erectAt).not.toBeNull();
    expect(erectAt ?? 0).toBeGreaterThan((upToSpeedAt ?? 0) + 20);
  });

  it('topples again after the engine is shut down', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 10);
    sim.controls.set('throttle', 0.175);
    run(sim, 150);
    expect(sim.vacuum.attitudeErect).toBe(true);

    // Mixture to idle cutoff: the engine stops, the pump stops with it.
    sim.controls.set('mixture', 0);
    run(sim, 400);
    expect(sim.vacuum.attitudeErect).toBe(false);
  });
});

/**
 * The suction regulator, which is what decides whether any of the above
 * happens at all.
 */
describe('vacuum supply', () => {
  /**
   * A regression test for a bug that looked like the attitude indicator
   * being broken. Suction was modelled as a straight line from zero to the
   * green at cruise RPM, so at the 172's 650 RPM idle it sat below what the
   * gyros need — and an aeroplane started and left at idle, which is what
   * happens, never erected at all.
   */
  it('is in the green at idle, not only at cruise', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 8);

    sim.controls.set('throttle', 0);
    run(sim, 25);

    expect(sim.engine.rpm).toBeLessThan(800);
    // The green arc on the gauge is 4.6 to 5.4.
    expect(sim.vacuum.suction).toBeGreaterThan(4.6);
  });

  it('keeps the gyros turning at idle rather than letting them run down', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 8);

    sim.controls.set('throttle', 0);
    run(sim, 200);

    expect(sim.vacuum.gyroSpool).toBeGreaterThan(0.95);
    expect(sim.vacuum.attitudeErect).toBe(true);
  });

  it('makes no suction while the starter is turning the engine', () => {
    const sim = newSim();
    prepareForStart(sim);
    expect(sim.vacuum.suction).toBeLessThan(0.1);
  });
});
