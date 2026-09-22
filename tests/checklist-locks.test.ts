import { describe, expect, it } from 'vitest';
import { ChecklistRunner } from '../src/sim/Checklist';
import { Simulation } from '../src/sim/Simulation';
import { C172N } from '../src/aircraft/c172n';
import type { ChecklistItem } from '../src/aircraft/types';
import { advanceTo, CHECKLIST_ACTIONS, primeStroke, run, STEP } from './helpers';

/**
 * The guard rail: exactly one step's controls answer at a time.
 *
 * A step already done cannot be undone, so the child cannot switch the
 * electrics back off while hunting for the next thing and quietly unmake
 * their own progress. A step not yet reached cannot be done early, so a
 * switch thrown out of order does not stay thrown.
 *
 * The failure this is built to catch is not a switch that moves when it
 * should not — it is a switch that *will not move when it should*, which
 * presents as the aeroplane being broken and has no message attached to it.
 * So most of what is asserted here is the unlocking.
 */

const ITEMS: readonly ChecklistItem[] = C172N.checklists.flatMap((s) => s.items);

function controlsOf(item: ChecklistItem): readonly string[] {
  if (item.controls) return item.controls;
  return item.highlight ? [item.highlight] : [];
}

function fresh(): { sim: Simulation; checklist: ChecklistRunner } {
  const sim = new Simulation(C172N);
  return { sim, checklist: new ChecklistRunner(C172N.checklists, sim) };
}

describe('checklist authoring', () => {
  it('names only controls the aeroplane actually has', () => {
    const sim = new Simulation(C172N);
    const missing: string[] = [];
    for (const item of ITEMS) {
      for (const id of controlsOf(item)) {
        if (!sim.controls.has(id)) missing.push(`${item.id} → ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * A step that points at a control it has not declared would arm the arrow
   * for a switch the same step then refuses to let the pilot touch.
   */
  it('always includes what it points at among what it may touch', () => {
    const wrong = ITEMS.filter(
      (item) => item.highlight && !controlsOf(item).includes(item.highlight),
    ).map((item) => item.id);
    expect(wrong).toEqual([]);
  });
});

describe('the guard rail', () => {
  /**
   * The one that matters. Every step must be doable when it is asked for —
   * including the ones whose controls belong to an earlier step too, which
   * is the whole of the shutdown section.
   */
  it('opens every step\'s own controls while that step is current', () => {
    const { sim, checklist } = fresh();
    const shut: string[] = [];

    for (let guard = 0; guard < ITEMS.length + 5 && !checklist.finished; guard++) {
      if (checklist.holding) checklist.release();
      const item = checklist.position?.item;
      if (!item) break;

      for (const id of controlsOf(item)) {
        if (checklist.isLocked(id)) shut.push(`${item.id} → ${id}`);
      }

      CHECKLIST_ACTIONS[item.id]?.(sim);
      let waited = 0;
      while (checklist.position?.item.id === item.id && waited < 45) {
        sim.tick(STEP);
        checklist.update(STEP);
        waited += STEP;
      }
    }

    expect(shut).toEqual([]);
    expect(checklist.finished).toBe(true);
  });

  it('holds a step that has not been reached, and says so', () => {
    const { checklist } = fresh();
    expect(checklist.position?.item.id).toBe('seats');

    expect(checklist.isLocked('seatLatch')).toBe(false);
    expect(checklist.isLocked('masterBattery')).toBe(true);
    expect(checklist.lockReason('masterBattery')).toBe('not-yet');
  });

  it('holds a step that is done, and says so', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'belts');

    expect(checklist.isDone('seats')).toBe(true);
    expect(checklist.isLocked('seatLatch')).toBe(true);
    expect(checklist.lockReason('seatLatch')).toBe('done');
  });

  /**
   * Both halves of the split master are the same step, and the breaker scan
   * is about all eighteen. A step that declared only the control its arrow
   * points at would lock the pilot out of finishing it.
   */
  it('opens both halves of the master together', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'master-on');
    expect(checklist.isLocked('masterBattery')).toBe(false);
    expect(checklist.isLocked('masterAlternator')).toBe(false);
  });

  it('opens the whole breaker row for the scan', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'breakers-in');

    const breakers = [...sim.controls.definitions()].filter((d) => d.kind === 'breaker');
    expect(breakers.length).toBeGreaterThan(1);
    for (const def of breakers) {
      expect(checklist.isLocked(def.id), def.id).toBe(false);
    }
  });

  /** Shutdown is the proof that a lock is not one-way. */
  it('hands a control back when a later step wants it again', () => {
    const { sim, checklist } = fresh();

    advanceTo(sim, checklist, 'beacon-on');
    expect(checklist.isLocked('mixture')).toBe(true);
    expect(checklist.lockReason('mixture')).toBe('not-yet');

    advanceTo(sim, checklist, 'shutdown-mixture');
    expect(checklist.isLocked('mixture')).toBe(false);
  });

  /**
   * The cockpit is not reduced to one live switch. Nothing the checklist
   * never mentions is ever held, so the aeroplane stays something you can
   * poke at between steps.
   */
  it('never holds a control the checklist does not ask for', () => {
    const { sim, checklist } = fresh();
    const named = new Set(ITEMS.flatMap(controlsOf));
    const free = [...sim.controls.definitions()]
      .map((d) => d.id)
      .filter((id) => !named.has(id));
    expect(free.length).toBeGreaterThan(0);

    for (let guard = 0; guard < ITEMS.length + 5 && !checklist.finished; guard++) {
      if (checklist.holding) checklist.release();
      const item = checklist.position?.item;
      if (!item) break;
      for (const id of free) expect(checklist.isLocked(id), id).toBe(false);
      CHECKLIST_ACTIONS[item.id]?.(sim);
      let waited = 0;
      while (checklist.position?.item.id === item.id && waited < 45) {
        sim.tick(STEP);
        checklist.update(STEP);
        waited += STEP;
      }
    }
  });

  /**
   * Starting an engine and stopping one are two decisions. The list reaches
   * the end of the start, holds, and does not ask for anything until it is
   * told to — so a child can sit in a running aeroplane for as long as they
   * like without the screen nagging them to turn it off again.
   */
  it('holds between the start and the shutdown until it is asked', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'ammeter-check');
    expect(checklist.holding).toBe(false);

    CHECKLIST_ACTIONS['ammeter-check']?.(sim);
    for (let t = 0; t < 60 * 3; t++) {
      sim.tick(STEP);
      checklist.update(STEP);
    }

    expect(checklist.goalReached).toBe(true);
    expect(checklist.holding).toBe(true);
    // Nothing on screen, nothing to point at, and not "finished" either.
    expect(checklist.position).toBeNull();
    expect(checklist.highlight).toBeNull();
    expect(checklist.finished).toBe(false);

    // And it stays there: the shutdown does not begin on its own.
    for (let t = 0; t < 60 * 30; t++) {
      sim.tick(STEP);
      checklist.update(STEP);
    }
    expect(checklist.holding).toBe(true);
    expect(checklist.isDone('shutdown-throttle')).toBe(false);

    checklist.release();
    expect(checklist.holding).toBe(false);
    expect(checklist.position?.item.id).toBe('shutdown-throttle');
  });

  /**
   * The reward for starting the aeroplane should not be a dead cockpit. The
   * throttle stays live so the engine can be played with; the controls that
   * would stop it do not, because a stopped engine cannot satisfy the
   * shutdown's first step and there would be no way forward.
   */
  it('leaves the free-play controls live while it holds', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'ammeter-check');
    CHECKLIST_ACTIONS['ammeter-check']?.(sim);
    for (let t = 0; t < 60 * 3; t++) {
      sim.tick(STEP);
      checklist.update(STEP);
    }
    expect(checklist.holding).toBe(true);

    for (const id of C172N.freePlayControls ?? []) {
      expect(checklist.isLocked(id), id).toBe(false);
    }
    for (const id of ['mixture', 'magKey', 'masterBattery', 'fuelSelector']) {
      expect(checklist.isLocked(id), id).toBe(true);
    }

    // Revving it does not start the shutdown by itself.
    sim.controls.set('throttle', 0.6);
    for (let t = 0; t < 60 * 5; t++) {
      sim.tick(STEP);
      checklist.update(STEP);
    }
    expect(checklist.holding).toBe(true);

    // And the list still works once it is asked for.
    checklist.release();
    expect(checklist.position?.item.id).toBe('shutdown-throttle');
    expect(checklist.isLocked('throttle')).toBe(false);
  });

  /**
   * Clearing a flooded engine is a POH procedure over the mixture and the
   * throttle, and both belong to steps long since done by the time a child
   * can flood it. Without the fault handing them back, over-priming — the
   * likeliest mistake there is, because pumping is the fun control — would
   * be a dead end with nothing behind it but "start again".
   */
  it('hands back the controls an active fault needs to be put right', () => {
    const { sim, checklist } = fresh();
    advanceTo(sim, checklist, 'prime');

    primeStroke(sim, 9);
    run(sim, 1);
    advanceTo(sim, checklist, 'start');

    expect(sim.faults.isActive('flooded')).toBe(true);
    expect(checklist.isLocked('mixture')).toBe(false);
    expect(checklist.isLocked('throttle')).toBe(false);
    expect(checklist.lockReason('mixture')).toBeNull();
    // And only those: the fault is not a general amnesty.
    expect(checklist.isLocked('carbHeat')).toBe(true);
  });
});
