import type { ControlDef } from '../aircraft/types';

export type ControlChangeListener = (id: string, value: number, previous: number) => void;

/**
 * The single source of truth for where every cockpit control is set.
 *
 * Values are plain numbers so the whole simulation stays serialisable and
 * testable without a renderer:
 *   toggle / breaker → 0 or 1
 *   pushPull         → 0 (fully out) .. 1 (fully in)
 *   selector / key   → index into the control's `positions`
 *   wheel            → 0 .. 1
 */
export class ControlState {
  private readonly defs = new Map<string, ControlDef>();
  private readonly values = new Map<string, number>();
  private readonly listeners = new Set<ControlChangeListener>();

  constructor(controls: readonly ControlDef[]) {
    for (const def of controls) {
      if (this.defs.has(def.id)) {
        throw new Error(`Duplicate control id "${def.id}"`);
      }
      this.defs.set(def.id, def);
    }
    this.reset();
  }

  /** Returns every control to its cold-and-dark position. */
  reset(): void {
    for (const [id, def] of this.defs) {
      this.values.set(id, initialValue(def));
    }
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  def(id: string): ControlDef {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown control "${id}"`);
    return def;
  }

  definitions(): Iterable<ControlDef> {
    return this.defs.values();
  }

  /** Raw numeric value. Unknown ids return 0 so optional kit is easy to omit. */
  num(id: string): number {
    return this.values.get(id) ?? 0;
  }

  bool(id: string): boolean {
    return this.num(id) > 0.5;
  }

  /** Detent name of a selector or key. */
  pos(id: string): string {
    const def = this.defs.get(id);
    if (!def || (def.kind !== 'selector' && def.kind !== 'key')) {
      throw new Error(`Control "${id}" has no detent positions`);
    }
    return def.positions[Math.round(this.num(id))] ?? def.positions[0] ?? '';
  }

  /** Convenience for readable checklist predicates and system logic. */
  isAt(id: string, position: string): boolean {
    return this.has(id) && this.pos(id) === position;
  }

  set(id: string, value: number): void {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown control "${id}"`);
    const next = clampFor(def, value);
    const prev = this.values.get(id) ?? 0;
    if (next === prev) return;
    this.values.set(id, next);
    for (const listener of this.listeners) listener(id, next, prev);
  }

  onChange(listener: ControlChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Snapshot for tests and save states. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  restore(snapshot: Record<string, number>): void {
    for (const [id, value] of Object.entries(snapshot)) {
      if (this.defs.has(id)) this.set(id, value);
    }
  }
}

function initialValue(def: ControlDef): number {
  switch (def.kind) {
    case 'toggle':
      return def.initial ? 1 : 0;
    case 'breaker':
      // Breakers are set (pushed in) on a healthy aeroplane, unless this one
      // is meant to be found popped.
      return def.popped ? 0 : 1;
    case 'pushPull':
      return def.initial ?? 0;
    case 'selector':
    case 'key':
      return def.initial ?? 0;
    case 'wheel':
      return def.initial ?? 0.5;
  }
}

function clampFor(def: ControlDef, value: number): number {
  switch (def.kind) {
    case 'toggle':
    case 'breaker':
      return value > 0.5 ? 1 : 0;
    case 'pushPull':
    case 'wheel':
      return Math.min(1, Math.max(0, value));
    case 'selector':
    case 'key':
      return Math.min(def.positions.length - 1, Math.max(0, Math.round(value)));
  }
}
