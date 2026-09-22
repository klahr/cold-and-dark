import { describe, expect, it } from 'vitest';
import { crank, newSim, prepareForStart, run } from './helpers';

/**
 * The prime waits for the pilot.
 *
 * The manifold charge used to evaporate over about half a minute, which is
 * honest about a real aeroplane and wrong for this one. Three strokes — the
 * number the Swedish copy asks for — put 1.65 charge units in against the
 * 1.0 needed to catch, so the engine became unstartable nineteen seconds
 * after the last stroke. Between PRIME and START the child still has to
 * crack the throttle to a quarter inch and physically look out of both
 * windows for the propeller check, and the overlay's own `STUCK_AFTER` puts
 * fifteen seconds on a *single* step.
 *
 * So the aeroplane was failing the pilot it was built for, on the clock,
 * for a reason that had scrolled off the screen by the time it bit. Every
 * other mistake in this simulation is something the pilot did.
 *
 * The rest of the suite cranks within a fraction of a second of priming
 * (`prepareForStart`), so nothing else here would notice it coming back.
 */
describe('primer charge does not fade', () => {
  it('starts on three strokes after a child-paced delay', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 3 });
    // Long enough to fumble the throttle, look left, look right, and find
    // the key — several times over.
    run(sim, 300);

    crank(sim, 4);
    run(sim, 6);

    expect(sim.engine.state).toBe('running');
    expect(sim.faults.isActive('not-primed')).toBe(false);
  });

  it('holds the charge indefinitely', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 3 });
    const charged = sim.fuel.primeCharge;
    expect(charged).toBeGreaterThan(sim.definition.systems.engine.primeToCatch);

    run(sim, 600);
    expect(sim.fuel.primeCharge).toBeCloseTo(charged, 6);
  });

  /**
   * Waiting must not be a way to un-flood the engine either. The only way
   * out of a flooded engine is still the POH clearing procedure.
   */
  it('does not let a flooded engine recover by being left alone', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 9 });
    crank(sim, 4);
    expect(sim.faults.isActive('flooded')).toBe(true);

    run(sim, 300);
    crank(sim, 6);
    run(sim, 3);
    expect(sim.engine.state).not.toBe('running');
  });
});
