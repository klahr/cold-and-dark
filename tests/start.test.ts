import { describe, expect, it } from 'vitest';
import { crank, newSim, prepareForStart, primeStroke, run, select } from './helpers';

/**
 * The golden start: follow the POH and the engine runs. Every other test in
 * this suite changes exactly one thing about this sequence.
 */
describe('normal cold start', () => {
  it('starts, makes oil pressure and charges the battery', () => {
    const sim = newSim();
    prepareForStart(sim);

    expect(sim.engine.isRunning).toBe(false);
    crank(sim, 3);
    run(sim, 6);

    expect(sim.engine.state).toBe('running');
    expect(sim.engine.rpm).toBeGreaterThan(700);
    expect(sim.engine.oilPressure).toBeGreaterThan(
      sim.definition.systems.engine.oilPressureRedlineLow,
    );
    expect(sim.electrical.alternatorOnline).toBe(true);
    expect(sim.electrical.ammeter).toBeGreaterThan(0);
    expect(sim.faults.isActive('no-oil-pressure')).toBe(false);
    expect(sim.faults.isActive('flooded')).toBe(false);
  });

  it('reaches 1000 RPM when the throttle is set for warm-up', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 4);

    sim.controls.set('throttle', 0.175);
    run(sim, 8);
    expect(sim.engine.rpm).toBeGreaterThan(900);
    expect(sim.engine.rpm).toBeLessThan(1250);
  });

  it('spins the gyros up only once the engine is driving the vacuum pump', () => {
    const sim = newSim();
    prepareForStart(sim);
    expect(sim.vacuum.suction).toBeLessThan(0.5);
    expect(sim.vacuum.gyroSpool).toBeLessThan(0.1);

    crank(sim, 3);
    run(sim, 60);

    expect(sim.vacuum.suction).toBeGreaterThan(4.0);
    expect(sim.vacuum.gyroSpool).toBeGreaterThan(0.95);
    // The turn coordinator is electric and was already up on battery power.
    expect(sim.vacuum.turnCoordinatorSpool).toBeGreaterThan(0.95);
  });

  it('does not need priming once the engine is warm', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 120);
    expect(sim.engine.isWarm).toBe(true);

    // Shut down, then restart with no prime at all.
    sim.controls.set('mixture', 0);
    run(sim, 6);
    expect(sim.engine.isRunning).toBe(false);

    sim.controls.set('mixture', 1);
    run(sim, 0.2);
    crank(sim, 4);
    run(sim, 3);
    expect(sim.engine.state).toBe('running');
  });
});

describe('mistakes that stop the engine starting', () => {
  it('cranks without firing when the mixture is at idle cutoff', () => {
    const sim = newSim();
    prepareForStart(sim, { mixture: 0 });
    crank(sim, 8);

    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('mixture-cutoff')).toBe(true);
  });

  it('will not start with the fuel selector OFF', () => {
    const sim = newSim();
    prepareForStart(sim, { fuel: 'OFF' });
    crank(sim, 8);

    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('fuel-off')).toBe(true);
  });

  it('will not crank at all with the master off', () => {
    const sim = newSim();
    prepareForStart(sim, { master: false });
    crank(sim, 6);

    expect(sim.engine.rpm).toBe(0);
    expect(sim.engine.isRunning).toBe(false);
    expect(sim.electrical.busVolts).toBe(0);
  });

  it('will not fire cold without prime', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 0 });
    crank(sim, 8);

    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('not-primed')).toBe(true);
  });

  it('floods when over-primed, and clears with the POH procedure', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 10 });
    crank(sim, 6);

    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('flooded')).toBe(true);
    const flooded = sim.engine.floodLevel;
    expect(flooded).toBeGreaterThanOrEqual(1);

    // Clear it: mixture idle cutoff, throttle wide open, crank.
    sim.controls.set('mixture', 0);
    sim.controls.set('throttle', 1);
    crank(sim, 8);
    expect(sim.engine.floodLevel).toBeLessThan(flooded);

    // Let the starter cool, then start normally.
    run(sim, 60);
    sim.controls.set('mixture', 1);
    sim.controls.set('throttle', 0.15);
    run(sim, 0.2);
    primeStroke(sim, 2);
    crank(sim, 5);
    run(sim, 4);
    expect(sim.engine.state).toBe('running');
  });

  it('warns when the throttle is left wide open for the start', () => {
    const sim = newSim();
    prepareForStart(sim, { throttle: 1 });
    crank(sim, 4);
    expect(sim.faults.isActive('throttle-too-far')).toBe(true);
  });
});

describe('starter and battery limits', () => {
  it('locks the starter out past its duty cycle and releases it after cooling', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 0 });

    select(sim, 'magKey', 'START');
    run(sim, 18);

    expect(sim.faults.isActive('starter-hot')).toBe(true);
    expect(sim.ignition.starterEngaged).toBe(false);
    expect(sim.engine.rpm).toBeLessThan(50);

    select(sim, 'magKey', 'BOTH');
    run(sim, 90);
    expect(sim.ignition.lockedOut).toBe(false);
  });

  it('flattens the battery under repeated cranking', () => {
    const sim = newSim();
    prepareForStart(sim, { strokes: 0 });

    // Ten attempts inside the duty cycle, with a cooling period between.
    for (let i = 0; i < 10; i++) {
      crank(sim, 12);
      run(sim, 55);
    }

    expect(sim.electrical.charge).toBeLessThan(0.35);
    expect(sim.faults.isActive('battery-low')).toBe(true);
  });

  it('flags the starter being held in once the engine is running', () => {
    const sim = newSim();
    prepareForStart(sim);
    select(sim, 'magKey', 'START');
    run(sim, 8);

    expect(sim.engine.isRunning).toBe(true);
    expect(sim.faults.isActive('starter-while-running')).toBe(true);
  });
});

describe('failures in flight-idle', () => {
  it('runs on the float bowl and then quits when the fuel is turned off', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 5);
    expect(sim.engine.isRunning).toBe(true);

    select(sim, 'fuelSelector', 'OFF');
    run(sim, 6);
    expect(sim.engine.isRunning).toBe(true); // still living off the bowl

    run(sim, 14);
    expect(sim.engine.isRunning).toBe(false);
    expect(sim.faults.isActive('fuel-starvation')).toBe(true);
  });

  it('stops the engine when the magnetos are switched off', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 5);

    select(sim, 'magKey', 'OFF');
    run(sim, 6);
    expect(sim.engine.isRunning).toBe(false);
  });

  it('raises the 30-second oil pressure warning when the pump fails', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 3);
    expect(sim.engine.isRunning).toBe(true);

    // Simulate a failed oil pump by holding the pressure on the peg.
    for (let i = 0; i < 60 * 40; i++) {
      sim.engine.oilPressure = 0;
      sim.tick(1 / 60);
    }
    expect(sim.faults.isActive('no-oil-pressure')).toBe(true);
  });

  it('reports low voltage when the alternator half of the master is off', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 5);
    expect(sim.electrical.lowVoltage).toBe(false);

    sim.controls.set('masterAlternator', 0);
    run(sim, 1);
    expect(sim.electrical.alternatorOnline).toBe(false);
    expect(sim.electrical.lowVoltage).toBe(true);
    expect(sim.electrical.ammeter).toBeLessThan(0);
  });
});

describe('shutdown', () => {
  it('stops on the mixture and goes fully dead', () => {
    const sim = newSim();
    prepareForStart(sim);
    crank(sim, 3);
    run(sim, 5);

    sim.controls.set('avionicsMaster', 0);
    sim.controls.set('mixture', 0);
    run(sim, 8);
    expect(sim.engine.rpm).toBe(0);
    expect(sim.engine.state).toBe('off');

    select(sim, 'magKey', 'OFF');
    sim.controls.set('masterBattery', 0);
    sim.controls.set('masterAlternator', 0);
    run(sim, 1);

    expect(sim.electrical.busPowered).toBe(false);
    expect(sim.electrical.busVolts).toBe(0);
    expect(sim.ignition.sparkStrength).toBe(0);
  });
});

describe('determinism', () => {
  it('reaches the same state at different frame rates', () => {
    const fast = newSim();
    const slow = newSim();

    for (const sim of [fast, slow]) {
      prepareForStart(sim);
    }
    // 120 Hz and 30 Hz both funnel through the same fixed substep.
    crankAt(fast, 3, 1 / 120);
    crankAt(slow, 3, 1 / 30);
    run(fast, 8, 1 / 120);
    run(slow, 8, 1 / 30);

    expect(fast.engine.state).toBe(slow.engine.state);
    expect(fast.engine.rpm).toBeCloseTo(slow.engine.rpm, 0);
    expect(fast.engine.oilPressure).toBeCloseTo(slow.engine.oilPressure, 0);
  });
});

function crankAt(
  sim: ReturnType<typeof newSim>,
  seconds: number,
  step: number,
): void {
  select(sim, 'magKey', 'START');
  run(sim, seconds, step);
  select(sim, 'magKey', 'BOTH');
  run(sim, 0.2, step);
}
