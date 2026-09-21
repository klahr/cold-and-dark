import type { ControlDef, ToggleControl } from '../types';
import { ARMREST, CABIN } from '../../render/frame';

/**
 * Panel furniture that is the same on every light single: a row of paddle
 * light switches, a bank of circuit breakers, the split master rocker.
 * Aircraft definitions compose these rather than repeating the geometry.
 */

/**
 * The door handle sits above the armrest, where a 172's does — and, more to
 * the point, out of it. At armrest height no amount of moving it inboard
 * helped: it was inside the armrest box either way, which looks exactly like
 * being sunk into the door.
 */
const DOOR_HANDLE_Y = ARMREST.y + ARMREST.height / 2 + 0.08;
/**
 * How far in from the nominal cabin half-width the handle's base sits. Small:
 * the base belongs against the lining, with the paddle body protruding into
 * the cabin from it. The lofted wall is a little outboard of the nominal
 * figure here, so this leaves about 12 mm of true clearance.
 */
const DOOR_INSET = 0.006;

/** A single paddle switch, as used for the exterior lights. */
export function paddleSwitch(
  id: string,
  label: string,
  placard: string,
  x: number,
  y: number,
  tooltip: string,
): ToggleControl {
  return {
    id,
    kind: 'toggle',
    style: 'paddle',
    label,
    tooltip,
    placard,
    mount: { x, y },
    width: 0.013,
    height: 0.024,
  };
}

/** The evenly spaced row of exterior light and pitot heat switches. */
export function lightSwitchRow(
  y: number,
  startX: number,
  pitch: number,
  entries: readonly (readonly [string, string, string, string])[],
): ControlDef[] {
  return entries.map(([id, label, placard, tooltip], i) =>
    paddleSwitch(id, label, placard, startX + i * pitch, y, tooltip),
  );
}

/** The two halves of the red split master rocker. */
export function masterRocker(x: number, y: number): ControlDef[] {
  return [
    {
      id: 'masterAlternator',
      kind: 'toggle',
      style: 'rocker',
      label: 'Alternator master',
      tooltip: 'Brings the alternator field online so the engine can charge the battery.',
      placard: 'ALT',
      mount: { x, y },
      width: 0.015,
      height: 0.026,
      color: 0xb0272b,
    },
    {
      id: 'masterBattery',
      kind: 'toggle',
      style: 'rocker',
      label: 'Battery master',
      tooltip: 'Connects the battery to the main bus. Nothing electrical works without it.',
      placard: 'BAT',
      mount: { x: x + 0.018, y },
      width: 0.015,
      height: 0.026,
      color: 0xb0272b,
    },
  ];
}

/** A row of circuit breakers across the copilot side of the panel. */
export function breakerRow(
  y: number,
  entries: readonly (readonly [string, string, number])[],
  startX = 0.205,
  pitch = 0.027,
): ControlDef[] {
  return entries.map(([id, placard, amps], i) => ({
    id,
    kind: 'breaker' as const,
    label: `${placard} breaker`,
    tooltip: `${amps} A circuit breaker. Pops out if the circuit overloads.`,
    placard,
    placardSize: 0.0032,
    mount: { x: startX + i * pitch, y },
    amps,
  }));
}

/** Bendix-style ignition key with a spring-loaded START detent. */
export function ignitionKey(x: number, y: number): ControlDef {
  return {
    id: 'magKey',
    kind: 'key',
    label: 'Magneto / starter key',
    tooltip:
      'Selects which magnetos are live. Click the right side to turn it clockwise, the left side to turn it back. Press and hold at START to crank.',
    placard: 'IGNITION',
    mount: { x, y },
    radius: 0.017,
    positions: ['OFF', 'R', 'L', 'BOTH', 'START'],
    angles: [-1.2, -0.6, 0.0, 0.6, 1.25],
    springFrom: 4,
    springTo: 3,
  };
}

/** Floor-mounted four-position fuel selector. */
export function fuelSelector(): ControlDef {
  const q = Math.PI / 2;
  return {
    id: 'fuelSelector',
    kind: 'selector',
    label: 'Fuel selector',
    tooltip:
      'Chooses which tank feeds the engine. BOTH for all normal operations. Click either side of the handle to turn it.',
    mount: { x: 0, y: 0, frame: 'console' },
    radius: 0.030,
    style: 'handle',
    positions: ['OFF', 'LEFT', 'BOTH', 'RIGHT'],
    angles: [Math.PI, -q, 0, q],
    // The trainer parks it OFF so the pilot has to set it, and finds out
    // what happens if they do not.
    initial: 0,
  };
}

/** Centre pedestal elevator trim wheel. */
export function trimWheel(): ControlDef {
  return {
    id: 'elevatorTrim',
    kind: 'wheel',
    label: 'Elevator trim',
    tooltip: 'Sets the trim tab. Takeoff setting is the marked band.',
    mount: { x: 0, y: 0, z: -0.01, frame: 'pedestal' },
    radius: 0.052,
    thickness: 0.009,
    sweep: 5.2,
    initial: 0.5,
  };
}

/* ------------------------------------------------------------------ */
/* Cabin items                                                         */
/* ------------------------------------------------------------------ */

/**
 * The checklist items that happen away from the panel: the seat, the belt,
 * the door and the control lock.
 *
 * These exist so that every line of the checklist is something the pilot
 * physically does, rather than a button that says "yes, I did that". A
 * timed run is only meaningful if the actions are real.
 */
export function cabinItems(pilotX: number): ControlDef[] {
  const side = Math.sign(pilotX) || -1;

  return [
    {
      id: 'seatLatch',
      kind: 'toggle',
      style: 'paddle',
      label: 'Seat latch',
      tooltip:
        'Locks the seat to its rails. A seat that slides on the takeoff roll takes the yoke with it.',
      // Outboard, under the front lip of the seat pan, where the real one
      // is — and, critically, proud of the cushion rather than inside it.
      mount: { x: pilotX - 0.17, y: 0.215, z: -0.05, frame: 'cabin', pitch: -1.15 },
      width: 0.055,
      height: 0.03,
      color: 0x8b9099,
    },
    {
      id: 'seatbelt',
      kind: 'toggle',
      style: 'rocker',
      label: 'Seat belt',
      tooltip: 'Lap belt and shoulder harness. Click the buckle to fasten it.',
      // Lying on the cushion by the pilot's inboard hip, where you would
      // reach for it.
      mount: { x: pilotX + 0.19, y: 0.325, z: 0.20, frame: 'cabin', pitch: -1.35 },
      width: 0.055,
      height: 0.04,
      color: 0x2b2f36,
    },
    {
      id: 'cabinDoor',
      kind: 'toggle',
      style: 'paddle',
      label: 'Cabin door latch',
      tooltip:
        'A 172 door that pops open on climb-out is startling and hard to close in flight. Latch it.',
      // Above the armrest, base against the lining, body protruding into
      // the cabin.
      mount: {
        x: side * (CABIN.halfWidth - DOOR_INSET),
        y: DOOR_HANDLE_Y,
        z: -0.05,
        frame: 'cabin',
        yaw: Math.PI / 2,
      },
      width: 0.055,
      height: 0.03,
      color: 0x8b9099,
    },
  ];
}
