import type { AircraftDefinition } from './types';
import { C172N } from './c172n';

/**
 * Every aircraft the trainer can load.
 *
 * One, deliberately. The definition format is general — a panel, a set of
 * instruments, a checklist and a systems block, with the renderer switching
 * on `ControlKind` and the simulation reading control values by id — so a
 * second airframe is an authoring job rather than an engine change. But an
 * abstraction with one implementation is cheaper to keep honest than one
 * with several, and this trainer is about a 172.
 */
export const AIRCRAFT: readonly AircraftDefinition[] = [C172N];

export const DEFAULT_AIRCRAFT_ID = C172N.id;

export function findAircraft(id: string): AircraftDefinition {
  const found = AIRCRAFT.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown aircraft "${id}"`);
  return found;
}
