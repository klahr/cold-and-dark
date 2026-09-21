/**
 * What the pilot has physically done with their head and hands, as opposed
 * to what the aeroplane's systems are doing.
 *
 * This exists so checklist items like "propeller area — clear" can be a real
 * action rather than a button that says "yes, I looked". The renderer feeds
 * head direction in; the checklist reads the flags out. Nothing here knows
 * about three.js, so it stays testable with the rest of the simulation.
 */
export class PilotState {
  /** Head yaw in radians: 0 straight ahead, negative left, positive right. */
  headYaw = 0;
  /** True once the pilot has actually looked out to the left. */
  checkedLeft = false;
  /** True once the pilot has actually looked out to the right. */
  checkedRight = false;

  /** Yaw beyond which the pilot is genuinely looking out of a side window. */
  static readonly LOOK_THRESHOLD = 1.05;

  reset(): void {
    this.headYaw = 0;
    this.checkedLeft = false;
    this.checkedRight = false;
  }

  /** Called every frame with where the pilot is looking. */
  setHeadYaw(yaw: number): void {
    this.headYaw = yaw;
    if (yaw > PilotState.LOOK_THRESHOLD) this.checkedLeft = true;
    if (yaw < -PilotState.LOOK_THRESHOLD) this.checkedRight = true;
  }

  /** True once both sides of the propeller arc have been looked at. */
  get scannedPropArea(): boolean {
    return this.checkedLeft && this.checkedRight;
  }
}
