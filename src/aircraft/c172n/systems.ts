import type { SystemsParams } from '../types';

/**
 * Cessna 172N systems parameters.
 *
 * Figures are taken from the POH where they are published (usable fuel, RPM
 * limits, the 30-second oil pressure rule, the starter duty cycle) and tuned
 * by feel where they are not (how much prime a cold engine wants, how long
 * the float bowl keeps it alive with the fuel selector off).
 *
 * The prime numbers are the ones worth understanding: one stroke delivers
 * 0.55 charge units, the engine needs 1.0 to catch cold, and it floods above
 * 3.5. That puts the POH's "two to six strokes" squarely in the window and
 * makes the seventh stroke the one that ruins the start.
 *
 * The charge does not leak away with time — see `sim/systems/Fuel.ts` for
 * why a modelled evaporation rate had to go.
 */
export const C172N_SYSTEMS: SystemsParams = {
  engine: {
    name: 'Lycoming O-320-H2AD',
    cylinders: 4,
    induction: 'carburetted',
    crankRpm: 240,
    idleCutoffRpm: 300,
    idleRpm: 650,
    maxRpm: 2700,
    primePerStroke: 0.55,
    primeToCatch: 1.0,
    primeToFlood: 3.5,
    catchSeconds: 1.2,
    oilPressureTimeout: 30,
    oilPressureIdle: 65,
    oilPressureRedlineLow: 25,
  },
  electrical: {
    nominalVolts: 14,
    batteryCapacityAh: 25,
    starterAmps: 160,
    alternatorAmps: 60,
    // Lycoming's limit is roughly ten seconds of cranking, then a rest.
    starterDutySeconds: 15,
    starterCooldownSeconds: 60,
  },
  fuel: {
    // 21.5 US gallons usable per tank.
    tankLitres: 81,
    carbBowlSeconds: 12,
  },
};
