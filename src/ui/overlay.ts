/**
 * What the overlay needs from `App`.
 *
 * There is one overlay — the Swedish children's one — so this is a plain
 * list of the things it asks the cockpit to do, rather than an interface
 * with implementations to choose between.
 */
export interface HudCallbacks {
  onReset(): void;
  /**
   * Take the pilot to the control: move to the viewpoint it is best seen
   * from, then aim at it. Hunting for a switch on the far side of the panel
   * is the thing most likely to stall a six-year-old.
   */
  onShowControl(id: string): void;
  onGuideControl(id: string | null): void;
  onToggleSound(on: boolean): void;
  onEnterVr(): void;
}

/**
 * A control's state in words, for the hover read-out. Produced in Swedish by
 * `kid/swedish.ts`, which is the only language the cockpit speaks.
 */
export interface ControlDescription {
  title: string;
  value: string;
  detail?: string;
}
