import type { ControlDef } from '../aircraft/types';
import type { Simulation } from '../sim/Simulation';

export interface ControlDescription {
  title: string;
  value: string;
  detail?: string;
}

/** Human-readable state of a control, for the hover tooltip. */
export function describeControl(def: ControlDef, sim: Simulation): ControlDescription {
  const v = sim.controls.num(def.id);
  const base: ControlDescription = { title: def.label, value: '' };
  if (def.tooltip) base.detail = def.tooltip;

  switch (def.kind) {
    case 'toggle':
      base.value = v > 0.5 ? 'ON' : 'OFF';
      break;
    case 'breaker':
      base.value = v > 0.5 ? 'IN (set)' : 'OUT (popped)';
      break;
    case 'selector':
    case 'key':
      base.value = sim.controls.pos(def.id);
      break;
    case 'wheel':
      base.value = `${Math.round(v * 100)}%`;
      break;
    case 'pushPull':
      base.value = describePushPull(def.id, v);
      if (def.id === 'primer') {
        base.detail = `${sim.fuel.primerStrokes} stroke${
          sim.fuel.primerStrokes === 1 ? '' : 's'
        } given. ${def.tooltip ?? ''}`;
      }
      break;
  }

  return base;
}

/**
 * Push-pull travel means different things on different knobs, so the read-out
 * uses the cockpit vocabulary rather than a bare percentage.
 */
function describePushPull(id: string, v: number): string {
  const pct = Math.round(v * 100);
  switch (id) {
    case 'mixture':
      if (v < 0.1) return 'IDLE CUTOFF';
      if (v > 0.95) return 'FULL RICH';
      return `${pct}% rich`;
    case 'throttle':
      if (v < 0.03) return 'CLOSED';
      if (v > 0.95) return 'FULL OPEN';
      return `${pct}% open`;
    case 'carbHeat':
      return v > 0.9 ? 'COLD' : v < 0.1 ? 'HOT' : `${100 - pct}% hot`;
    case 'parkingBrake':
      return v < 0.3 ? 'SET' : 'RELEASED';
    case 'primer':
      return v > 0.9 ? 'IN (locked)' : v < 0.12 ? 'FULLY OUT' : 'part way out';
    default:
      return v > 0.9 ? 'IN' : v < 0.1 ? 'OUT' : `${pct}% in`;
  }
}
