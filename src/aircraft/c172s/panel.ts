import type { ControlDef } from '../types';
import { KNOB_COLOR } from '../../render/materials';
import {
  breakerRow,
  fuelSelector,
  ignitionKey,
  lightSwitchRow,
  masterRocker,
  trimWheel,
  cabinItems,
} from '../shared/kit';

/**
 * C172S Skyhawk SP panel.
 *
 * Mechanically the same airframe as the 172N, but the fuel-injected IO-360
 * changes the bottom of the panel: there is no primer and no carburettor
 * heat, and an auxiliary fuel pump switch appears in the switch band. That
 * one substitution is what turns the whole start procedure on its head.
 */

const SWITCH_Y = -0.157;
const KNOB_Y = -0.226;

export const C172S_CONTROLS: readonly ControlDef[] = [
  // A little inboard of where it was. The ring of OFF/R/L/BOTH/START around
  // it ran off the edge of the panel and into the lining — invisible from
  // the seat, and part of why the switch was hard to read. It cannot come in
  // much further than this without the lettering reaching the master switch.
  ignitionKey(-0.420, -0.168),
  ...masterRocker(-0.386, SWITCH_Y),
  {
    id: 'avionicsMaster',
    kind: 'toggle',
    style: 'rocker',
    label: 'Avionics master',
    tooltip: 'Isolates the radios from starting transients. Off for start, on afterwards.',
    placard: 'AVIONICS',
    mount: { x: -0.325, y: SWITCH_Y },
    width: 0.016,
    height: 0.026,
  },
  {
    id: 'fuelPump',
    kind: 'toggle',
    style: 'rocker',
    label: 'Auxiliary fuel pump',
    tooltip:
      'Electric boost pump. Used to prime the injector lines before start, and as a backup to the engine-driven pump.',
    placard: 'FUEL PUMP',
    mount: { x: -0.283, y: SWITCH_Y },
    width: 0.016,
    height: 0.026,
    color: 0x2f6fa8,
  },

  ...lightSwitchRow(SWITCH_Y, -0.232, 0.04, [
    ['beacon', 'Beacon', 'BCN', 'Rotating beacon. On before the engine turns.'],
    ['landingLight', 'Landing light', 'LAND', 'Landing light.'],
    ['taxiLight', 'Taxi light', 'TAXI', 'Taxi light.'],
    ['navLights', 'Navigation lights', 'NAV', 'Position lights.'],
    ['strobes', 'Strobe lights', 'STROBE', 'Anti-collision strobes.'],
    ['pitotHeat', 'Pitot heat', 'PITOT', 'Heats the pitot tube against icing.'],
  ]),

  /* ---------------- Engine controls ---------------- */
  // No primer and no carburettor heat: an injected engine has neither.
  {
    id: 'throttle',
    kind: 'pushPull',
    label: 'Throttle',
    tooltip: 'Sets induction airflow, and therefore power. Open about a quarter inch for start.',
    placard: 'THROTTLE',
    placardAbove: true,
    mount: { x: -0.230, y: KNOB_Y },
    color: KNOB_COLOR.throttle,
    knobRadius: 0.023,
    travel: 0.050,
    shape: 'round',
    vernier: true,
    initial: 0,
  },
  {
    id: 'mixture',
    kind: 'pushPull',
    label: 'Mixture',
    tooltip:
      'Meters fuel to the injectors. On this engine it is also the start control: idle cutoff to crank, then advanced as it fires.',
    placard: 'MIXTURE',
    placardAbove: true,
    mount: { x: -0.130, y: KNOB_Y },
    color: KNOB_COLOR.mixture,
    knobRadius: 0.017,
    travel: 0.045,
    shape: 'round',
    vernier: true,
    initial: 0,
  },
  {
    id: 'cabinHeat',
    kind: 'pushPull',
    label: 'Cabin heat',
    placard: 'CABIN HT',
    placardAbove: true,
    mount: { x: 0.010, y: KNOB_Y },
    color: KNOB_COLOR.cabin,
    knobRadius: 0.011,
    travel: 0.035,
    shape: 'tee',
    initial: 1,
  },
  {
    id: 'cabinAir',
    kind: 'pushPull',
    label: 'Cabin air',
    placard: 'CABIN AIR',
    placardAbove: true,
    mount: { x: 0.090, y: KNOB_Y },
    color: KNOB_COLOR.cabin,
    knobRadius: 0.011,
    travel: 0.035,
    shape: 'tee',
    initial: 1,
  },
  {
    id: 'parkingBrake',
    kind: 'pushPull',
    label: 'Parking brake',
    tooltip: 'Pull out to hold the brakes on.',
    placard: 'PARK BRK',
    mount: { x: -0.408, y: -0.222 },
    color: KNOB_COLOR.cabin,
    knobRadius: 0.010,
    travel: 0.025,
    shape: 'round',
    initial: 1,
  },
  {
    id: 'flaps',
    kind: 'selector',
    label: 'Wing flaps',
    tooltip: 'Flap position selector.',
    placard: 'FLAPS',
    mount: { x: 0.238, y: -0.175 },
    radius: 0.016,
    style: 'lever',
    positions: ['UP', '10', '20', '30'],
    angles: [-0.7, -0.23, 0.23, 0.7],
  },

  fuelSelector(),
  trimWheel(),
  ...cabinItems(-0.25),

  ...breakerRow(0.16, [
    ['brkAltField', 'ALT FLD', 5],
    ['brkInstLights', 'INST LT', 5],
    ['brkNavLights', 'NAV LT', 10],
    ['brkBeacon', 'BCN', 10],
    ['brkLandLights', 'LAND LT', 15],
    ['brkPitotHeat', 'PITOT', 10],
    ['brkStrobe', 'STROBE', 10],
    ['brkTurnCoord', 'TURN CO', 5],
    ['brkFuelPump', 'FUEL PMP', 10],
  ]),
  ...breakerRow(0.098, [
    ['brkRadio1', 'RADIO 1', 5],
    ['brkRadio2', 'RADIO 2', 5],
    ['brkRadio3', 'RADIO 3', 5],
    ['brkXpdr', 'XPDR', 5],
    ['brkAdf', 'ADF', 5],
    ['brkAudio', 'AUDIO', 5],
    ['brkCigar', 'CIG LTR', 10],
    ['brkFuelInd', 'FUEL IND', 5],
    ['brkLowVolt', 'LOW VOLT', 5],
  ]),
];
