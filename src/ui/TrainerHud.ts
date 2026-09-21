import type { ChecklistRunner } from '../sim/Checklist';
import type { QualityLevel } from '../render/postfx';
import type { ControlDescription } from './describeControl';
import type { VrSupport } from '../input/VrSession';
import type { VrCardContent } from './VrChecklistCard';

/** Which of the two overlays is driving the cockpit. */
export type UiMode = 'expert' | 'kid';

export interface HudCallbacks {
  onSelectView(index: number): void;
  onReset(): void;
  /** Aim the pilot's head at a control from wherever they are sitting. */
  onFocusControl(id: string): void;
  /**
   * Take the pilot to the control: move to the viewpoint it is best seen
   * from, then aim at it. Used by the kid UI, where hunting for a switch on
   * the far side of the panel is the thing most likely to stall a six-year-old.
   */
  onShowControl(id: string): void;
  onGuideControl(id: string | null): void;
  onToggleSound(on: boolean): void;
  onToggleYokes(visible: boolean): void;
  onSelectAircraft(id: string): void;
  onSetQuality(level: QualityLevel): void;
  onSelectUiMode(mode: UiMode): void;
  onEnterVr(): void;
}

/**
 * What `App` needs from an overlay. Two implement it: the expert `Hud`, and
 * the Swedish `KidHud` for a child who can read but has never seen a cockpit.
 * Both drive the same simulation through the same `ChecklistRunner`, so the
 * aeroplane behaves identically — only the words and the amount of help change.
 */
export interface TrainerHud {
  readonly checklist: ChecklistRunner;
  /**
   * What the in-headset wrist board should show right now. Each overlay
   * supplies it in its own language, so the board never has to know which
   * one is driving.
   */
  vrCardContent(): VrCardContent;
  setActiveView(index: number): void;
  setVrSupport(support: VrSupport): void;
  setVrPresenting(presenting: boolean): void;
  setInspecting(on: boolean): void;
  setQuality(level: QualityLevel): void;
  setSoundState(on: boolean): void;
  setYokeState(visible: boolean): void;
  showTooltip(description: ControlDescription | null, x: number, y: number): void;
  refreshTooltip(description: ControlDescription): void;
  onActuate(id: string): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}
