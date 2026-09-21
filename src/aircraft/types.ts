import type * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';

/**
 * An aircraft is described entirely by data in this file's shapes. The
 * renderer switches on `ControlKind` to pick a mesh factory and a drag
 * gesture; the simulation only ever reads control values by id. Adding a
 * second airframe is therefore an authoring job, not an engine change.
 */

export type ControlKind =
  | 'toggle'
  | 'pushPull'
  | 'selector'
  | 'key'
  | 'breaker'
  | 'wheel';

/** Which cockpit frame a control's coordinates are relative to. */
/**
 * `cabin` is the whole cockpit in world coordinates, for the handful of
 * things that are not on a panel at all: the door latch, the seat belt, the
 * control lock.
 */
export type MountFrame = 'panel' | 'console' | 'pedestal' | 'cabin';

export interface Mount {
  /** Metres, in the chosen frame. For the panel, x/y lie on the panel face. */
  x: number;
  y: number;
  /** Offset out of the mounting surface. Defaults to 0. */
  z?: number;
  /** Rotation about the surface normal, radians. */
  roll?: number;
  /** Rotation about the vertical, for things mounted on a cabin wall. */
  yaw?: number;
  /** Tilt, for things lying flat such as a seat belt buckle. */
  pitch?: number;
  frame?: MountFrame;
}

interface ControlBase {
  id: string;
  /** Short name shown on hover and in checklist callouts. */
  label: string;
  /** One line explaining what the control does, shown on hover. */
  tooltip?: string;
  mount: Mount;
  /** Panel silkscreen text placed under the control. */
  placard?: string;
  /** Put the placard above the control instead; used along the bottom edge. */
  placardAbove?: boolean;
  /** Cap height of the placard text, metres. Defaults to 0.0048. */
  placardSize?: number;
}

/** A switch with two states. `split` renders as one half of a paired rocker. */
export interface ToggleControl extends ControlBase {
  kind: 'toggle';
  style: 'rocker' | 'paddle';
  /** Rocker body size in metres. */
  width?: number;
  height?: number;
  /** Colour of the rocker body; red for the master switch halves. */
  color?: number;
  /** Labels for the two throws, bottom-to-top. */
  states?: readonly [string, string];
}

/**
 * A push-pull control: throttle, mixture, carb heat, primer, cabin heat.
 * Value is normalised travel where 1 = fully pushed IN and 0 = fully OUT,
 * matching the cockpit idiom ("mixture in = rich", "carb heat out = hot").
 */
export interface PushPullControl extends ControlBase {
  kind: 'pushPull';
  color: number;
  /** Knob radius, metres. */
  knobRadius: number;
  /** Total travel of the shaft, metres. */
  travel: number;
  shape: 'round' | 'tee' | 'ring';
  /** A vernier knob can also be screwed in for fine control. */
  vernier?: boolean;
  /**
   * A pump rather than a setting: the sim counts complete out-and-in cycles
   * as strokes. The primer is the only one on the 172.
   */
  pump?: boolean;
  /** Twist-lock that must be released before the control will move. */
  lockable?: boolean;
  /** Value the control holds when the aircraft is cold and dark. */
  initial?: number;
}

/** A rotary with labelled detents. Value is the index into `positions`. */
export interface SelectorControl extends ControlBase {
  kind: 'selector';
  positions: readonly string[];
  /** Handle angle at each detent, radians, clockwise from up. */
  angles: readonly number[];
  radius: number;
  style: 'handle' | 'knob' | 'lever';
  initial?: number;
}

/**
 * The magneto/starter key. Same as a selector, but the last detent is
 * spring-loaded: let go and it snaps back.
 */
export interface KeyControl extends ControlBase {
  kind: 'key';
  positions: readonly string[];
  angles: readonly number[];
  radius: number;
  /** Detent index that springs back, and where it returns to. */
  springFrom: number;
  springTo: number;
  initial?: number;
}

/** A pull-type circuit breaker. Value 1 = set (in), 0 = popped (out). */
export interface BreakerControl extends ControlBase {
  kind: 'breaker';
  amps: number;
}

/** A hand wheel such as elevator trim. Value is normalised 0..1. */
export interface WheelControl extends ControlBase {
  kind: 'wheel';
  radius: number;
  thickness: number;
  /** Total wheel rotation across the full value range, radians. */
  sweep: number;
  initial?: number;
}

export type ControlDef =
  | ToggleControl
  | PushPullControl
  | SelectorControl
  | KeyControl
  | BreakerControl
  | WheelControl;

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

export interface InstrumentContext {
  /** Case diameter or plate width, metres. */
  size: number;
}

export interface InstrumentHandle {
  object: THREE.Object3D;
  /** Called every frame with the current simulation state. */
  update(sim: Simulation, dt: number): void;
  dispose?(): void;
}

export interface InstrumentDef {
  id: string;
  label: string;
  mount: Mount;
  /** Case diameter for round instruments, or plate width for clusters. */
  size: number;
  build: (ctx: InstrumentContext) => InstrumentHandle;
}

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

/**
 * One line of the checklist. Every item is verified against the simulation:
 * there is no "acknowledge" escape hatch, because a step you confirm with a
 * button is not a step you have practised — and in the timed game's hard
 * mode there is no checklist panel to put such a button on.
 */
export interface ChecklistItem {
  id: string;
  /** POH-style callout, e.g. "MIXTURE — RICH". */
  callout: string;
  /** Control to highlight in 3D while this item is current. */
  highlight?: string;
  /** True once the pilot has done the thing. */
  satisfied: (sim: Simulation) => boolean;
  /** Why the step exists. This is the actual teaching content. */
  why: string;
  /** What to physically do, shown if the pilot is stuck. */
  hint: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  items: readonly ChecklistItem[];
  /**
   * `secure` marks the sections that come after the goal. The timed
   * challenge is "start the aeroplane", so the clock stops once every
   * non-secure section is complete; shutting down again afterwards is
   * practice, not part of the run.
   */
  phase?: 'start' | 'secure';
}

/* ------------------------------------------------------------------ */
/* Aircraft                                                            */
/* ------------------------------------------------------------------ */

export interface AircraftDefinition {
  id: string;
  name: string;
  /** One-line description shown in the aircraft picker. */
  summary: string;
  controls: readonly ControlDef[];
  instruments: readonly InstrumentDef[];
  /**
   * Lettering silkscreened onto the panel that is not attached to any one
   * control: the registration, limitation placards, section headings. A
   * real panel is covered in this text and its absence is one of the
   * clearest tells that a rendered cockpit is not a real one.
   */
  placards?: readonly PanelPlacard[];
  checklists: readonly ChecklistSection[];
  /** Engine, electrical and fuel parameters consumed by the simulation. */
  systems: SystemsParams;
}

/** A line of panel lettering, positioned in panel-local metres. */
export interface PanelPlacard {
  text: string;
  x: number;
  y: number;
  /** Cap height in metres. Defaults to 0.0048, the size used for controls. */
  size?: number;
}

export interface SystemsParams {
  engine: EngineParams;
  electrical: ElectricalParams;
  fuel: FuelParams;
}

export interface EngineParams {
  /** Display name, e.g. "Lycoming O-320-H2AD". */
  name: string;
  cylinders: number;
  /** Fuel delivery, which decides whether priming or boost pump applies. */
  induction: 'carburetted' | 'injected';
  /** RPM the starter can drag the engine to on a healthy battery. */
  crankRpm: number;
  /** RPM below which a running engine dies. */
  idleCutoffRpm: number;
  /** Warm idle RPM with the throttle closed. */
  idleRpm: number;
  maxRpm: number;
  /** Prime delivered by one full primer stroke, in arbitrary charge units. */
  primePerStroke: number;
  /** Charge needed in the induction system for the engine to catch. */
  primeToCatch: number;
  /** Charge above which the engine floods. */
  primeToFlood: number;
  /** Seconds for the prime charge to evaporate away. */
  primeDecaySeconds: number;
  /** Seconds of cranking with fuel and spark before the engine fires. */
  catchSeconds: number;
  /** Oil pressure must reach the green within this many seconds. */
  oilPressureTimeout: number;
  oilPressureIdle: number;
  oilPressureRedlineLow: number;
}

export interface ElectricalParams {
  nominalVolts: number;
  batteryCapacityAh: number;
  /** Amps the starter motor pulls while cranking. */
  starterAmps: number;
  /** Amps the alternator can supply once the engine is running. */
  alternatorAmps: number;
  /** Seconds of continuous cranking before the starter must cool down. */
  starterDutySeconds: number;
  starterCooldownSeconds: number;
}

export interface FuelParams {
  /** Usable fuel per tank, litres. */
  tankLitres: number;
  /**
   * How long the engine can run on the carburettor bowl alone after the
   * fuel supply is cut. This is what makes "fuel selector OFF" teachable:
   * the engine starts, runs, and then quits.
   */
  carbBowlSeconds: number;
}
