import type { ChecklistItem, ChecklistSection } from '../aircraft/types';
import type { Simulation } from './Simulation';

export interface ChecklistPosition {
  section: ChecklistSection;
  item: ChecklistItem;
  sectionIndex: number;
  itemIndex: number;
}

/**
 * How long an item must stay satisfied before the list moves on. Without
 * this, anything that was already set ticks off before the pilot has had a
 * chance to read it.
 */
const DWELL_SECONDS = 0.9;

/**
 * Walks the pilot through the checklist, verifying each step against the
 * simulation rather than taking their word for it.
 */
export class ChecklistRunner {
  private sectionIndex = 0;
  private itemIndex = 0;
  private satisfiedFor = 0;
  private held = false;
  private readonly done = new Set<string>();
  private readonly listeners = new Set<(item: ChecklistItem) => void>();

  /** Every control any item names; the rest of the cockpit stays free. */
  private readonly managed: ReadonlySet<string>;

  constructor(
    private readonly sections: readonly ChecklistSection[],
    private readonly sim: Simulation,
  ) {
    this.managed = new Set(
      sections.flatMap((section) => section.items.flatMap((item) => itemControls(item))),
    );
  }

  /** Where the cursor stands, whether or not the list is asking for it. */
  private get cursor(): ChecklistPosition | null {
    const section = this.sections[this.sectionIndex];
    if (!section) return null;
    const item = section.items[this.itemIndex];
    if (!item) return null;
    return { section, item, sectionIndex: this.sectionIndex, itemIndex: this.itemIndex };
  }

  /**
   * The step being asked for, or null while the list is holding or done.
   *
   * Null during the hold on purpose: nothing should tick off, no arrow should
   * arm and no step should be on screen while the aeroplane is simply sitting
   * there running.
   */
  get position(): ChecklistPosition | null {
    return this.held ? null : this.cursor;
  }

  /**
   * True once the aeroplane is started and before the shutdown has been
   * asked for.
   *
   * Starting an engine and stopping one are two decisions, not one long
   * procedure. Running the list straight on into the shutdown made the
   * reward for getting it going a fresh instruction to turn it all off, so
   * the list stops at the boundary and waits to be asked.
   */
  get holding(): boolean {
    return this.held;
  }

  /** Begins the shutdown. Nothing else releases the hold. */
  release(): void {
    this.held = false;
  }

  get finished(): boolean {
    return !this.held && this.cursor === null;
  }

  /**
   * The control the current item wants pointed at, or null.
   *
   * Resolved here rather than read off the item, because a step about a row
   * of controls has to work out which one still needs doing — and every
   * overlay, on a screen and in a headset, must agree about the answer.
   */
  get highlight(): string | null {
    const item = this.position?.item;
    if (!item) return null;
    return item.highlightNow?.(this.sim) ?? item.highlight ?? null;
  }

  get allSections(): readonly ChecklistSection[] {
    return this.sections;
  }

  isDone(itemId: string): boolean {
    return this.done.has(itemId);
  }

  /* ------------------------------------------------------------------ */
  /* The guard rail                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Whether the pilot is allowed to move a control at all right now.
   *
   * Exactly one step is live at a time, and only that step's controls
   * answer. Everything else the checklist knows about is held where it
   * stands — which covers both halves of the same rule:
   *
   *  - a step already done cannot be undone, so the electrics stay on once
   *    they are on and the child cannot quietly unmake their own progress
   *    while hunting for the next switch;
   *  - a step not yet reached cannot be done early, so a switch thrown out
   *    of order does not stay thrown.
   *
   * Controls the checklist never mentions — the landing light, the flaps,
   * the trim wheel — are not managed and stay free the whole time. Poking
   * at the aeroplane is not a mistake, and locking the cockpit down to the
   * one live switch would make it a slideshow.
   *
   * This is a query rather than a stored flag, so nothing has to remember to
   * refresh it and the simulation stays as testable as the rest.
   */
  isLocked(controlId: string): boolean {
    if (!this.managed.has(controlId)) return false;
    // Between the start and the shutdown there is no live step, so without
    // this the cockpit would go dead the moment the engine came alive.
    if (this.held && this.sim.definition.freePlayControls?.includes(controlId)) return false;
    const item = this.position?.item;
    if (item && itemControls(item).includes(controlId)) return false;
    // A mistake that needs a locked control to put right would otherwise be
    // a dead end with nothing but "start again" behind it.
    return !this.recoveryControls().has(controlId);
  }

  /**
   * Why a control will not move, so the overlay can say the right thing:
   * `not-yet` for a step still ahead, `done` for one already behind.
   */
  lockReason(controlId: string): 'done' | 'not-yet' | null {
    if (!this.isLocked(controlId)) return null;
    for (const section of this.sections) {
      for (const item of section.items) {
        if (!this.done.has(item.id) && itemControls(item).includes(controlId)) {
          return 'not-yet';
        }
      }
    }
    return 'done';
  }

  /** Controls an active fault's recovery needs, whatever the list thinks. */
  private recoveryControls(): Set<string> {
    const out = new Set<string>();
    for (const fault of this.sim.faults.active()) {
      for (const id of fault.recovery ?? []) out.add(id);
    }
    return out;
  }

  /** Progress through the whole list, 0..1. */
  get progress(): number {
    const total = this.sections.reduce((n, s) => n + s.items.length, 0);
    return total === 0 ? 1 : this.done.size / total;
  }

  /** Items up to and including getting the engine running and settled. */
  private get goalItems(): readonly ChecklistItem[] {
    return this.sections
      .filter((s) => s.phase !== 'secure')
      .flatMap((s) => s.items as ChecklistItem[]);
  }

  /** True once the aeroplane is started, which is the moment worth marking. */
  get goalReached(): boolean {
    return this.goalItems.every((i) => this.done.has(i.id));
  }

  restart(): void {
    this.sectionIndex = 0;
    this.itemIndex = 0;
    this.satisfiedFor = 0;
    this.held = false;
    this.done.clear();
  }

  onAdvance(listener: (item: ChecklistItem) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(dt: number): void {
    const pos = this.position;
    if (!pos) return;

    const ok = pos.item.satisfied(this.sim);

    if (!ok) {
      this.satisfiedFor = 0;
      return;
    }

    this.satisfiedFor += dt;
    if (this.satisfiedFor >= DWELL_SECONDS) {
      this.done.add(pos.item.id);
      for (const listener of this.listeners) listener(pos.item);
      this.advance();
    }
  }

  private advance(): void {
    this.satisfiedFor = 0;
    const section = this.sections[this.sectionIndex];
    if (!section) return;
    if (this.itemIndex + 1 < section.items.length) {
      this.itemIndex += 1;
      return;
    }
    this.sectionIndex += 1;
    this.itemIndex = 0;
    // Everything the aeroplane was started for is done. Stopping it again is
    // the pilot's own decision, so the list waits here until it is asked.
    const next = this.sections[this.sectionIndex];
    if (next?.phase === 'secure' && section.phase !== 'secure') this.held = true;
  }
}

/**
 * The controls a step may touch: what it declares, or the one it points at.
 */
function itemControls(item: ChecklistItem): readonly string[] {
  if (item.controls) return item.controls;
  return item.highlight ? [item.highlight] : [];
}
