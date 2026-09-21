import type { AircraftDefinition } from '../types';
import { steamGaugePanel } from '../shared/steamPanel';
import { panelPlacards } from '../shared/placards';
import { C172S_CONTROLS } from './panel';
import { C172S_CHECKLISTS } from './checklists';
import { C172S_SYSTEMS } from './systems';

/**
 * The extensibility proof. Nothing in `src/sim/`, `src/render/` or
 * `src/input/` knows this aeroplane exists — it is three data modules and
 * a call to the same shared panel builder the 172N uses.
 */
export const C172S: AircraftDefinition = {
  id: 'c172s',
  name: 'Cessna 172S Skyhawk SP',
  summary: 'Fuel-injected Lycoming IO-360, boost-pump priming, no carburettor heat.',
  controls: C172S_CONTROLS,
  instruments: steamGaugePanel({
    systems: C172S_SYSTEMS,
    greenRpm: [2100, 2700],
    redlineRpm: 2700,
    showFuelFlow: true,
  }),
  placards: panelPlacards('N53993'),
  checklists: C172S_CHECKLISTS,
  systems: C172S_SYSTEMS,
};
