import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft/registry';
import { Simulation } from '../src/sim/Simulation';

/**
 * Every step before the engine is running must be something the pilot does.
 *
 * A checklist item that is already satisfied on a cold and dark aeroplane
 * ticks itself the instant the list reaches it. Nothing looks broken — the
 * list simply advances a line on its own — and the step teaches nothing,
 * because the pilot never touched the thing it is about. The avionics master
 * was exactly this: it started off, "AVIONICS POWER SWITCH — OFF" was true
 * before it was read, and the one moment in the procedure that explains what
 * the switch is *for* went past unnoticed. It is now found on, as the last
 * pilot left it.
 *
 * There are no exceptions at present. The breaker scan used to be one — on
 * an aeroplane where every breaker is in, "CIRCUIT BREAKERS — CHECK IN" is
 * true before it is read — until the aeroplane was given a popped one to
 * find.
 */
const CHECKS_NOT_ACTIONS = new Set<string>();

describe('checklist steps are actions', () => {
  for (const aircraft of AIRCRAFT) {
    it(`${aircraft.id}: nothing before the start ticks itself`, () => {
      const sim = new Simulation(aircraft);
      // One tick, so anything that depends on a system having run has run.
      sim.tick(1 / 60);

      const freebies: string[] = [];
      for (const section of aircraft.checklists) {
        if (section.phase === 'secure') continue;
        for (const item of section.items) {
          if (CHECKS_NOT_ACTIONS.has(item.id)) continue;
          if (item.satisfied(sim)) freebies.push(`${item.id} — "${item.callout}"`);
        }
      }
      expect(freebies).toEqual([]);
    });

    /**
     * And any exception has to name a step that exists: one left behind for
     * a step that has been renamed is an exception that silently covers
     * something else.
     */
    it(`${aircraft.id}: every documented exception is a real item`, () => {
      const ids = new Set(aircraft.checklists.flatMap((s) => s.items.map((i) => i.id)));
      for (const id of CHECKS_NOT_ACTIONS) {
        expect(ids.has(id), `${id} is not on the checklist`).toBe(true);
      }
    });
  }
});
