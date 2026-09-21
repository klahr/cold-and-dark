import type { InstrumentDef } from '../types';
import { INSTRUMENT_D } from '../../render/frame';
import type { SystemsParams } from '../types';
import {
  GAUGE,
  annunciator,
  attitudeIndicator,
  engineCluster,
  headingIndicator,
  roundGauge,
  turnCoordinator,
  wetCompass,
} from '../../render/instruments/gauges';
import { radioUnit, vorIndicator } from '../../render/instruments/avionics';

const LARGE = INSTRUMENT_D.large;
const SMALL = INSTRUMENT_D.small;

/** Column and row centres of the pilot's instrument panel, in panel metres. */
// Column centres for the six-pack, then the VOR heads and the engine
// cluster. Column A used to sit at -0.44, which put its outer bezel 0.480
// from the centreline — outside a cabin that measures 0.464 at instrument
// height, so the panel edge cut through the airspeed indicator and the
// lining hid it from the left seat. The columns are pulled inboard and the
// pitch tightened from 0.093 to 0.088 to buy the room back; see
// tests/panel-fit.test.ts, which now checks this arithmetic.
const COL = { a: -0.400, b: -0.312, c: -0.224, vor: -0.148, eng: -0.055 } as const;
const ROW = { top: 0.165, mid: 0.072, low: -0.021 } as const;

const DEG = Math.PI / 180;

export interface SteamPanelOptions {
  systems: SystemsParams;
  /** Tachometer green arc, in RPM. */
  greenRpm: readonly [number, number];
  redlineRpm: number;
  /**
   * Fuel-injected aeroplanes show fuel flow instead of a fourth quantity
   * gauge in the cluster, which is the pilot's cue while priming.
   */
  showFuelFlow?: boolean;
}

/**
 * The centre stack. Frequencies are fixed — these units are here so the
 * panel looks like a 172 and so the avionics master visibly does something.
 */
const STACK_X = 0.085;
const STACK_W = 0.16;

const RADIO_STACK: readonly InstrumentDef[] = [
  {
    id: 'audioPanel',
    label: 'Audio panel',
    mount: { x: STACK_X, y: 0.212 },
    size: STACK_W,
    build: radioUnit({
      model: 'KMA 24',
      rows: [{ label: 'AUDIO', active: 'COM 1', standby: 'SPKR' }],
      aspect: 0.3,
      knobs: 1,
    }),
  },
  {
    id: 'com1',
    label: 'COM/NAV 1',
    mount: { x: STACK_X, y: 0.143 },
    size: STACK_W,
    build: radioUnit({
      model: 'KX 155',
      rows: [
        { label: 'COM', active: '118.30', standby: '121.90' },
        { label: 'NAV', active: '113.40', standby: '110.20' },
      ],
      aspect: 0.52,
    }),
  },
  {
    id: 'com2',
    label: 'COM/NAV 2',
    mount: { x: STACK_X, y: 0.055 },
    size: STACK_W,
    build: radioUnit({
      model: 'KX 155',
      rows: [
        { label: 'COM', active: '122.80', standby: '119.10' },
        { label: 'NAV', active: '108.60', standby: '112.00' },
      ],
      aspect: 0.52,
    }),
  },
  {
    id: 'adf',
    label: 'ADF receiver',
    mount: { x: STACK_X, y: -0.013 },
    size: STACK_W,
    build: radioUnit({
      model: 'KR 87',
      rows: [{ label: 'ADF', active: '0350', standby: 'ANT' }],
      aspect: 0.3,
    }),
  },
  {
    id: 'transponder',
    label: 'Transponder',
    mount: { x: STACK_X, y: -0.072 },
    size: STACK_W,
    build: radioUnit({
      model: 'KT 76A',
      rows: [{ label: 'XPDR', active: '1200', standby: 'SBY' }],
      aspect: 0.3,
      knobs: 3,
    }),
  },
  {
    id: 'elt',
    label: 'ELT remote',
    mount: { x: STACK_X, y: -0.128 },
    size: STACK_W,
    build: radioUnit({
      model: 'ELT',
      rows: [{ label: 'ARM', active: 'ARMED' }],
      aspect: 0.26,
      knobs: 1,
    }),
  },
];

export function steamGaugePanel(opts: SteamPanelOptions): readonly InstrumentDef[] {
  const tank = opts.systems.fuel.tankLitres;
  return [
  /* ------------------ Pilot's six-pack ------------------ */
  {
    id: 'airspeed',
    label: 'Airspeed indicator',
    mount: { x: COL.a, y: ROW.top },
    size: LARGE,
    build: roundGauge(
      {
        min: 0,
        max: 180,
        startAngle: 0,
        endAngle: 320 * DEG,
        majorStep: 20,
        minorStep: 10,
        title: 'AIRSPEED',
        unit: 'KNOTS',
        arcs: [
          { from: 33, to: 85, color: GAUGE.white, radius: 0.94, width: 0.045 },
          { from: 44, to: 127, color: GAUGE.green },
          { from: 127, to: 158, color: GAUGE.yellow },
          { from: 158, to: 180, color: GAUGE.red },
        ],
      },
      // The aeroplane never moves, so this needle sits on the stop — which
      // is itself worth seeing during a run-up.
      [{ read: () => 0 }],
    ),
  },
  {
    id: 'attitude',
    label: 'Attitude indicator',
    mount: { x: COL.b, y: ROW.top },
    size: LARGE,
    build: attitudeIndicator(),
  },
  {
    id: 'altimeter',
    label: 'Altimeter',
    mount: { x: COL.c, y: ROW.top },
    size: LARGE,
    build: roundGauge(
      {
        min: 0,
        max: 1000,
        startAngle: 0,
        endAngle: 360 * DEG,
        majorStep: 100,
        minorStep: 20,
        labelFormat: (v) => String(Math.round(v / 100) % 10),
        title: 'ALT',
        subtitle: '100 FEET',
      },
      [
        // Hundreds needle, then the shorter thousands needle behind it.
        { read: () => 250 % 1000, scale: 1 },
        { read: () => (250 / 10) % 1000, scale: 0.68, color: 0xd6d9dd },
      ],
    ),
  },
  {
    id: 'turnCoordinator',
    label: 'Turn coordinator',
    mount: { x: COL.a, y: ROW.mid },
    size: LARGE,
    build: turnCoordinator(),
  },
  {
    id: 'headingIndicator',
    label: 'Heading indicator',
    mount: { x: COL.b, y: ROW.mid },
    size: LARGE,
    build: headingIndicator(310),
  },
  {
    id: 'verticalSpeed',
    label: 'Vertical speed indicator',
    mount: { x: COL.c, y: ROW.mid },
    size: LARGE,
    build: roundGauge(
      {
        min: -20,
        max: 20,
        startAngle: -160 * DEG,
        endAngle: 160 * DEG,
        majorStep: 5,
        minorStep: 1,
        labelFormat: (v) => String(Math.abs(v)),
        title: 'VERTICAL SPEED',
        unit: '100 FT/MIN',
      },
      [{ read: () => 0 }],
    ),
  },

  /* ------------------ Bottom row ------------------ */
  {
    id: 'tachometer',
    label: 'Tachometer',
    mount: { x: COL.a, y: ROW.low },
    size: LARGE,
    build: roundGauge(
      {
        min: 0,
        max: 35,
        startAngle: -140 * DEG,
        endAngle: 140 * DEG,
        majorStep: 5,
        minorStep: 1,
        title: 'RPM',
        subtitle: 'HUNDREDS',
        arcs: [
          { from: opts.greenRpm[0] / 100, to: opts.greenRpm[1] / 100, color: GAUGE.green },
          { from: opts.redlineRpm / 100, to: 35, color: GAUGE.red },
        ],
      },
      [{ read: (sim) => sim.engine.rpm / 100 }],
    ),
  },
  {
    id: 'suction',
    label: 'Suction gauge',
    mount: { x: COL.b, y: ROW.low },
    size: SMALL,
    build: roundGauge(
      {
        min: 0,
        max: 10,
        startAngle: -130 * DEG,
        endAngle: 130 * DEG,
        majorStep: 2,
        minorStep: 1,
        title: 'SUCTION',
        unit: 'IN HG',
        arcs: [{ from: 4.6, to: 5.4, color: GAUGE.green }],
      },
      [{ read: (sim) => sim.vacuum.suction }],
    ),
  },
  {
    id: 'ammeter',
    label: 'Ammeter',
    mount: { x: COL.c, y: ROW.low },
    size: SMALL,
    build: roundGauge(
      {
        min: -60,
        max: 60,
        startAngle: -75 * DEG,
        endAngle: 75 * DEG,
        majorStep: 30,
        minorStep: 10,
        labelFormat: (v) => (v === 0 ? '0' : String(Math.abs(v))),
        title: 'AMMETER',
        subtitle: '− DISCH   CHARGE +',
      },
      [{ read: (sim) => sim.electrical.ammeter }],
    ),
  },

  /* ------------------ Engine cluster ------------------ */
  {
    id: 'engineCluster',
    label: 'Engine instrument cluster',
    mount: { x: COL.eng, y: 0.115 },
    size: 0.075,
    build: engineCluster(
      [
        {
          label: 'OIL °F',
          read: (sim) => sim.engine.oilTempC * 1.8 + 32,
          min: 75,
          max: 245,
          bands: [
            { from: 100, to: 245, color: GAUGE.green },
            { from: 245, to: 245, color: GAUGE.red },
          ],
        },
        {
          label: 'OIL PSI',
          read: (sim) => sim.engine.oilPressure,
          min: 0,
          max: 115,
          bands: [
            { from: opts.systems.engine.oilPressureRedlineLow, to: 60, color: GAUGE.yellow },
            { from: 60, to: 90, color: GAUGE.green },
            { from: 90, to: 115, color: GAUGE.red },
          ],
        },
        {
          label: 'FUEL L',
          read: (sim) => sim.fuel.leftLitres,
          min: 0,
          max: tank,
          bands: [{ from: 0, to: tank * 0.11, color: GAUGE.red }],
        },
        opts.showFuelFlow
          ? {
              label: 'FUEL GPH',
              read: (sim) => sim.fuel.fuelFlowGph,
              min: 0,
              max: 20,
              bands: [{ from: 0, to: 20, color: GAUGE.green }],
            }
          : {
              label: 'FUEL R',
              read: (sim) => sim.fuel.rightLitres,
              min: 0,
              max: tank,
              bands: [{ from: 0, to: tank * 0.11, color: GAUGE.red }],
            },
      ],
      1.85,
    ),
  },
  {
    id: 'lowVoltAnnunciator',
    label: 'Low voltage warning',
    mount: { x: COL.eng, y: -0.028 },
    size: 0.062,
    build: annunciator('LOW\nVOLTAGE', '#e0a83c', (sim) => sim.electrical.lowVoltage),
  },
  {
    id: 'starterAnnunciator',
    label: 'Starter engaged',
    mount: { x: COL.eng, y: -0.062 },
    size: 0.062,
    build: annunciator('STARTER', '#7fc4f0', (sim) => sim.ignition.starterEngaged),
  },

  /* ------------------ Navigation heads (indication only) ------------------ */
  {
    id: 'vor1',
    label: 'VOR 1 indicator',
    mount: { x: COL.vor, y: ROW.top },
    size: LARGE,
    build: vorIndicator('VOR 1', 360),
  },
  {
    id: 'vor2',
    label: 'VOR 2 indicator',
    mount: { x: COL.vor, y: ROW.mid },
    size: LARGE,
    build: vorIndicator('VOR 2', 360),
  },

  /* ------------------ Wet compass ------------------ */
  {
    id: 'magneticCompass',
    label: 'Magnetic compass',
    // Clipped to the windscreen centre post, above the glareshield.
    mount: { x: 0, y: 1.185, z: -0.66, frame: 'cabin', pitch: -0.26 },
    size: 0.085,
    build: wetCompass(310),
  },

  /* ------------------ Radio stack ------------------ */
  ...RADIO_STACK,
  ];
}
