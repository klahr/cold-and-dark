import type { AircraftDefinition } from '../types';
import { steamGaugePanel } from '../shared/steamPanel';
import { panelPlacards } from '../shared/placards';
import { C172N_CONTROLS } from './panel';
import { C172N_CHECKLISTS } from './checklists';
import { C172N_SYSTEMS } from './systems';

export const C172N: AircraftDefinition = {
  id: 'c172n',
  name: 'Cessna 172N Skyhawk',
  summary: 'Carburetted Lycoming O-320, analog six-pack, primer and magneto key.',
  controls: C172N_CONTROLS,
  instruments: steamGaugePanel({
    systems: C172N_SYSTEMS,
    greenRpm: [2100, 2700],
    redlineRpm: 2700,
  }),
  placards: panelPlacards('N738QK'),
  checklists: C172N_CHECKLISTS,
  systems: C172N_SYSTEMS,
};
