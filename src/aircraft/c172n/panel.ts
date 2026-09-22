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
 * C172N panel layout, in panel-local metres.
 *
 * The panel face is 1.04 m wide and 0.52 m tall, so x runs -0.52..0.52 and y
 * runs -0.26..0.26. Proportions follow a real 172N panel: pilot's six-pack on
 * the left, engine cluster and VOR heads centre-left, radio stack
 * centre-right, circuit breakers on the copilot side, and the switch band
 * plus push-pull controls along the bottom.
 */

/** y of the switch row and the push-pull knob row. */
const SWITCH_Y = -0.157;
const KNOB_Y = -0.226;

export const C172N_CONTROLS: readonly ControlDef[] = [
  /* ---------------- Ignition and electrical ---------------- */
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
    // Found on, as the last pilot left it. Starting it off made "AVIONICS
    // POWER SWITCH — OFF" tick itself before the pilot had read it, and a
    // step that is always already done is a step that teaches nothing — the
    // same reasoning as the carburettor heat below. It is on the checklist
    // precisely because it is found the wrong way round, and switching it
    // is visible: the radio stack goes dark.
    initial: true,
  },

  /* ---------------- Exterior and pitot heat ---------------- */
  ...lightSwitchRow(SWITCH_Y, -0.272, 0.04, [
    ['beacon', 'Beacon', 'BCN', 'Rotating beacon. On before the engine turns.'],
    ['landingLight', 'Landing light', 'LAND', 'Landing light.'],
    ['taxiLight', 'Taxi light', 'TAXI', 'Taxi light.'],
    ['navLights', 'Navigation lights', 'NAV', 'Position lights.'],
    ['strobes', 'Strobe lights', 'STROBE', 'Anti-collision strobes.'],
    ['pitotHeat', 'Pitot heat', 'PITOT', 'Heats the pitot tube against icing.'],
  ]),

  /* ---------------- Engine controls ---------------- */
  {
    id: 'primer',
    kind: 'pushPull',
    label: 'Primer',
    tooltip: 'Pumps raw fuel into the induction manifold. Pull fully out, push fully in.',
    placard: 'PRIMER',
    placardAbove: true,
    mount: { x: -0.335, y: KNOB_Y },
    color: KNOB_COLOR.primer,
    knobRadius: 0.011,
    travel: 0.045,
    shape: 'ring',
    pump: true,
    lockable: true,
    initial: 1,
  },
  {
    id: 'carbHeat',
    kind: 'pushPull',
    label: 'Carburettor heat',
    tooltip: 'Out routes warm unfiltered air to the carburettor. In is cold, filtered air.',
    placard: 'CARB HEAT',
    placardAbove: true,
    mount: { x: -0.243, y: KNOB_Y },
    color: KNOB_COLOR.carbHeat,
    knobRadius: 0.013,
    travel: 0.040,
    shape: 'tee',
    // Found as the last pilot left it, which is out. Starting it in made
    // "CARBURETTOR HEAT — COLD" tick itself before the pilot had read it —
    // and a step that is always already done is a step that teaches nothing.
    // It is on the checklist precisely because it is found out.
    initial: 0,
  },
  {
    id: 'throttle',
    kind: 'pushPull',
    label: 'Throttle',
    tooltip: 'Sets manifold airflow, and therefore power. Open about a quarter inch for start.',
    placard: 'THROTTLE',
    placardAbove: true,
    mount: { x: -0.132, y: KNOB_Y },
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
    tooltip: 'Fuel/air ratio. Fully in is rich; fully out is idle cutoff and shuts the engine down.',
    placard: 'MIXTURE',
    placardAbove: true,
    mount: { x: -0.036, y: KNOB_Y },
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
    mount: { x: 0.070, y: KNOB_Y },
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
    mount: { x: 0.150, y: KNOB_Y },
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

  /* ---------------- Flaps ---------------- */
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

  /* ---------------- Circuit breakers ---------------- */
  // The alternator field breaker is found popped. It is the one worth
  // finding: with it out the aeroplane starts perfectly normally, runs
  // perfectly normally, and never charges — so a pilot who waved the
  // breaker scan through meets the consequence at "AMMETER — CHECK
  // CHARGING" two minutes later, with the low-voltage light on.
  ...breakerRow(0.16, [
    ['brkAltField', 'ALT FLD', 5, true],
    ['brkInstLights', 'INST LT', 5],
    ['brkNavLights', 'NAV LT', 10],
    ['brkBeacon', 'BCN', 10],
    ['brkLandLights', 'LAND LT', 15],
    ['brkPitotHeat', 'PITOT', 10],
    ['brkStrobe', 'STROBE', 10],
    ['brkTurnCoord', 'TURN CO', 5],
    ['brkFlap', 'FLAP', 15],
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
