import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft/registry';
import { cabinHalfWidthAt } from '../src/render/fuselage';
import { ARMREST, PANEL, SEAT } from '../src/render/frame';

/**
 * Things mounted in the cabin rather than on the panel.
 *
 * The panel-fit test catches a control authored outside the panel. Nothing
 * caught the two bugs this covers, both of which were visible but whose
 * cause was not: the door handle authored 17 mm from a cabin wall that
 * curves, so the paddle sat inside the lining; and the control lock authored
 * as a fixed point rather than as a point on the column it is supposed to
 * pass through, so it floated in clear air above it.
 */
const CABIN_CONTROLS = AIRCRAFT.flatMap((aircraft) =>
  aircraft.controls
    .filter((c) => c.mount.frame === 'cabin')
    .map((c) => ({ aircraft: aircraft.id, control: c })),
);

/**
 * A wall-mounted switch belongs against the lining, with its body sticking
 * into the cabin — so the mount being close to the wall is correct, and only
 * being *outside* it is wrong.
 */
const MIN_WALL_CLEARANCE = 0.004;

describe('cabin furniture', () => {
  it('has some to check', () => {
    expect(CABIN_CONTROLS.length).toBeGreaterThan(0);
  });

  it('stands clear of the cabin lining', () => {
    for (const { aircraft, control } of CABIN_CONTROLS) {
      const { x, y, z } = control.mount;
      const wall = cabinHalfWidthAt(z ?? 0, y);
      const clearance = wall - Math.abs(x);
      expect(clearance, `${aircraft}/${control.id} at x=${x}, wall=${wall.toFixed(4)}`).toBeGreaterThan(
        MIN_WALL_CLEARANCE,
      );
    }
  });

  /**
   * The bug this is really here for. The door handle was authored at armrest
   * height, so it was inside the armrest box whatever its x — which looks
   * precisely like being sunk into the door, and moving it inboard only
   * pushed it deeper in.
   */
  it('does not bury anything inside the armrest', () => {
    for (const { aircraft, control } of CABIN_CONTROLS) {
      const { x, y, z } = control.mount;
      const inY = Math.abs(y - ARMREST.y) < ARMREST.height / 2;
      const inZ = Math.abs((z ?? 0) - ARMREST.z) < ARMREST.length / 2;
      // The armrest hugs the sidewall, so anything out near the wall at the
      // same height and station is inside it.
      const outboard = Math.abs(x) > 0.40;
      expect(
        inY && inZ && outboard,
        `${aircraft}/${control.id} at y=${y}, z=${z ?? 0} is inside the armrest`,
      ).toBe(false);
    }
  });

  it('is inside the cabin front to back', () => {
    for (const { aircraft, control } of CABIN_CONTROLS) {
      const z = control.mount.z ?? 0;
      expect(z, `${aircraft}/${control.id}`).toBeGreaterThan(PANEL.center[2]);
      expect(z, `${aircraft}/${control.id}`).toBeLessThan(SEAT.backZ);
    }
  });

});
