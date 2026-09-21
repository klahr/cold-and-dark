/**
 * Cockpit coordinate frame and shared dimensions.
 *
 * World axes (metres):
 *   +X = right (toward the copilot)
 *   +Y = up
 *   -Z = forward (toward the nose)
 *
 * Origin is on the cabin floor, on the centreline, at the seat datum.
 *
 * Panel space is a child frame used by every aircraft definition so that
 * control/instrument placement is authored in flat 2D panel coordinates:
 *   panel-local +X = right across the panel face
 *   panel-local +Y = up the panel face
 *   panel-local +Z = out of the panel face, toward the pilot
 *
 * Dimensions follow the real airframe: a C172 cabin is 1.0 m wide and about
 * 1.25 m from floor to headliner, which puts the glareshield roughly 0.15 m
 * below the seated pilot's eye and the panel face 0.75 m away. Getting this
 * right matters — if the panel is too tall the pilot cannot see over the nose.
 */

export const CABIN = {
  halfWidth: 0.50,
  floorY: 0,
  roofY: 1.26,
  firewallZ: -0.80,
  aftBulkheadZ: 0.95,
} as const;

export const PANEL = {
  /** Width and height of the main instrument panel face. */
  width: 1.04,
  height: 0.52,
  thickness: 0.026,
  /** World position of the panel face centre. */
  center: [0, 0.645, -0.60] as const,
  /** Backward tilt of the panel: the top leans toward the pilot. */
  tiltX: 0.09,
} as const;

export const PANEL_HALF_W = PANEL.width / 2;
export const PANEL_HALF_H = PANEL.height / 2;

/** Standard round instrument diameters (3 1/8" and 2 1/4" cases). */
export const INSTRUMENT_D = {
  large: 0.0794,
  small: 0.0572,
} as const;

export const SEAT = {
  pilotX: -0.25,
  copilotX: 0.25,
  panY: 0.27,
  frontZ: 0.0,
  backZ: 0.52,
} as const;

/**
 * The armrest along each door.
 *
 * Exported for the same reason as the column below: things get mounted near
 * it, and a control authored into the space it occupies is invisible without
 * being obviously misplaced in the source. The door handle sat inside this
 * box for exactly that reason — it read as "hidden in the door" when the
 * door lining was never the problem.
 */
export const ARMREST = {
  /** Centre height, and the box's section. */
  y: 0.55,
  width: 0.07,
  height: 0.04,
  /** Centre and length along the cabin. */
  z: 0.08,
  length: 0.44,
  /** How far its outboard face is set in from the sidewall. */
  inset: 0.035,
} as const;

/**
 * The control column, shared because things are mounted *on* it.
 *
 * The control lock is a pin through the column. Authored independently of
 * the column it passes through, it drifts off the moment either moves — and
 * it had: the lock was sitting 35 mm above a column 22 mm thick, floating in
 * clear air in front of the pilot.
 */
export const YOKE = {
  /** Hub centre: a forearm's reach from the seat back. */
  hubY: 0.60,
  hubZ: -0.34,
  /** Height at which the column disappears into the panel. */
  panelY: 0.66,
  columnRadius: 0.022,
} as const;

/**
 * Angle the column rises at on its way from the hub up into the panel.
 * Anything mounted through the column needs it to sit square to the shaft
 * rather than square to the world.
 */
export const YOKE_TILT = Math.atan2(YOKE.panelY - YOKE.hubY, YOKE.hubZ - PANEL.center[2]);

/** Default pilot eye point, left seat. */
export const EYE = [SEAT.pilotX, 1.05, 0.17] as const;

/** Top edge of the panel / glareshield line, in world Y. */
export const GLARESHIELD_Y = PANEL.center[1] + PANEL_HALF_H * Math.cos(PANEL.tiltX);
