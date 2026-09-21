import type { SystemsParams } from '../types';

/**
 * Cessna 172S systems parameters.
 *
 * For a fuel-injected engine the prime parameters are read per *second* of
 * boost-pump running rather than per primer stroke: 0.5 units a second
 * against 1.0 to catch puts the POH's "three to five seconds" comfortably in
 * the window, and seven seconds of pumping floods it.
 */
export const C172S_SYSTEMS: SystemsParams = {
  engine: {
    name: 'Lycoming IO-360-L2A',
    cylinders: 4,
    induction: 'injected',
    crankRpm: 250,
    idleCutoffRpm: 300,
    idleRpm: 680,
    maxRpm: 2700,
    primePerStroke: 0.5,
    primeToCatch: 1.0,
    primeToFlood: 3.5,
    // Injector lines hold their charge less long than a carburettor manifold.
    primeDecaySeconds: 22,
    catchSeconds: 1.1,
    oilPressureTimeout: 30,
    oilPressureIdle: 68,
    oilPressureRedlineLow: 20,
  },
  electrical: {
    nominalVolts: 14,
    batteryCapacityAh: 24,
    starterAmps: 170,
    alternatorAmps: 60,
    starterDutySeconds: 15,
    starterCooldownSeconds: 60,
  },
  fuel: {
    // 26.5 US gallons usable per tank.
    tankLitres: 100,
    // Injector lines hold very little: there is no float bowl to live off.
    carbBowlSeconds: 3,
  },
};
