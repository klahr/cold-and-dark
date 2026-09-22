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
  private readonly done = new Set<string>();
  private readonly listeners = new Set<(item: ChecklistItem) => void>();

  constructor(
    private readonly sections: readonly ChecklistSection[],
    private readonly sim: Simulation,
  ) {}

  get position(): ChecklistPosition | null {
    const section = this.sections[this.sectionIndex];
    if (!section) return null;
    const item = section.items[this.itemIndex];
    if (!item) return null;
    return { section, item, sectionIndex: this.sectionIndex, itemIndex: this.itemIndex };
  }

  get finished(): boolean {
    return this.position === null;
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

  /**
   * The first outstanding item that wants a given control, if it is not the
   * one currently being asked for.
   *
   * The list is walked strictly in order, so operating the right switch at
   * the wrong time looks exactly like the aeroplane ignoring you. This lets
   * the UI say what is actually going on.
   */
  pendingItemFor(controlId: string): ChecklistItem | null {
    const current = this.position?.item;
    if (current?.highlight === controlId) return null;
    for (const section of this.sections) {
      for (const item of section.items) {
        if (item.highlight === controlId && !this.done.has(item.id)) return item;
      }
    }
    return null;
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
    } else {
      this.sectionIndex += 1;
      this.itemIndex = 0;
    }
  }
}
