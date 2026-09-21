import type { AircraftDefinition } from './types';
import { C172N } from './c172n';
import { C172S } from './c172s';

/**
 * Every aircraft the trainer can load. A new airframe is added here and
 * nowhere else — the renderer, the simulation and the checklist engine all
 * work from the definition alone.
 */
export const AIRCRAFT: readonly AircraftDefinition[] = [C172N, C172S];

export const DEFAULT_AIRCRAFT_ID = C172N.id;

export function findAircraft(id: string): AircraftDefinition {
  const found = AIRCRAFT.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown aircraft "${id}"`);
  return found;
}
