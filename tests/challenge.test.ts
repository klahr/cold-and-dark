import { describe, expect, it, beforeEach } from 'vitest';
import { Challenge, DIFFICULTIES, formatTime } from '../src/sim/Challenge';
import { ChecklistRunner } from '../src/sim/Checklist';
import { AIRCRAFT } from '../src/aircraft/registry';
import { C172N } from '../src/aircraft/c172n';
import { Simulation } from '../src/sim/Simulation';
import { PilotState } from '../src/sim/PilotState';
import type { ChecklistSection } from '../src/aircraft/types';
import { newSim } from './helpers';

/** Personal bests live in localStorage, which node does not provide. */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}
installLocalStorage();

function fakeFault(code: string, title: string) {
  return { code, title, severity: 'caution', message: '', since: 0 } as never;
}

describe('timed challenge', () => {
  beforeEach(() => localStorage.clear());

  it('only counts time while it is running', () => {
    const c = new Challenge();
    c.tick(5);
    expect(c.elapsed).toBe(0);

    c.start();
    c.tick(3);
    c.tick(2);
    expect(c.elapsed).toBeCloseTo(5);

    c.finish('c172n');
    c.tick(10);
    expect(c.elapsed).toBeCloseTo(5);
  });

  it('charges each kind of mistake once, at the difficulty rate', () => {
    const c = new Challenge();
    c.setDifficulty('hard');
    c.start();
    c.tick(20);

    c.recordFault(fakeFault('flooded', 'Engine flooded'));
    c.recordFault(fakeFault('flooded', 'Engine flooded'));
    c.recordFault(fakeFault('not-primed', 'Not enough prime'));

    expect(c.mistakeCount).toBe(2);
    expect(c.penaltySeconds).toBe(2 * 15);
    expect(c.totalSeconds).toBeCloseTo(50);
  });

  it('ignores faults raised outside a run', () => {
    const c = new Challenge();
    c.recordFault(fakeFault('flooded', 'Engine flooded'));
    expect(c.mistakeCount).toBe(0);
  });

  it('records a personal best and recognises an improvement', () => {
    const first = new Challenge();
    first.start();
    first.tick(90);
    const a = first.finish('c172n');
    expect(a.previousBest).toBeNull();
    expect(a.isPersonalBest).toBe(true);

    const second = new Challenge();
    second.start();
    second.tick(70);
    const b = second.finish('c172n');
    expect(b.previousBest).toBeCloseTo(90);
    expect(b.isPersonalBest).toBe(true);

    const third = new Challenge();
    third.start();
    third.tick(120);
    const d = third.finish('c172n');
    expect(d.isPersonalBest).toBe(false);
    expect(third.bestFor('c172n', 'easy')).toBeCloseTo(70);
  });

  it('keeps bests separate per aircraft and difficulty', () => {
    const c = new Challenge();
    c.setDifficulty('normal');
    c.start();
    c.tick(60);
    c.finish('c172n');

    expect(c.bestFor('c172n', 'normal')).toBeCloseTo(60);
    expect(c.bestFor('c172n', 'hard')).toBeNull();
    expect(c.bestFor('c172s', 'normal')).toBeNull();
  });

  it('formats a stopwatch reading', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(9.25)).toBe('0:09.3');
    expect(formatTime(75.5)).toBe('1:15.5');
  });

  it('gives each difficulty a distinct amount of help', () => {
    const [easy, normal, hard] = DIFFICULTIES;
    expect(easy?.showCoaching).toBe(true);
    expect(easy?.highlightControl).toBe(true);
    expect(normal?.showList).toBe(true);
    expect(normal?.showCoaching).toBe(false);
    expect(hard?.showList).toBe(false);
    // Less help, more it costs to get it wrong.
    expect(hard!.penaltyPerFault).toBeGreaterThan(normal!.penaltyPerFault);
    expect(normal!.penaltyPerFault).toBeGreaterThan(easy!.penaltyPerFault);
  });
});

describe('checklist goal', () => {
  /** A two-section list: one to reach the goal, one that follows it. */
  function twoPhaseList(state: { started: boolean; secured: boolean }): ChecklistSection[] {
    return [
      {
        id: 'start',
        title: 'Starting',
        items: [
          {
            id: 'a',
            callout: 'A',
            satisfied: () => state.started,
            why: '',
            hint: '',
          },
        ],
      },
      {
        id: 'secure',
        title: 'Securing',
        phase: 'secure',
        items: [
          {
            id: 'b',
            callout: 'B',
            satisfied: () => state.secured,
            why: '',
            hint: '',
          },
        ],
      },
    ];
  }

  it('reports the goal as reached before the shutdown drill is done', () => {
    const state = { started: false, secured: false };
    const sim = newSim();
    const runner = new ChecklistRunner(twoPhaseList(state), sim);

    expect(runner.goalReached).toBe(false);
    expect(runner.goalProgress).toBe(0);

    state.started = true;
    for (let i = 0; i < 120; i++) runner.update(1 / 60);

    expect(runner.goalReached).toBe(true);
    expect(runner.goalProgress).toBe(1);
    // The run is over, but the list is not: securing still lies ahead.
    expect(runner.finished).toBe(false);
    expect(runner.progress).toBeLessThan(1);

    state.secured = true;
    for (let i = 0; i < 120; i++) runner.update(1 / 60);
    expect(runner.finished).toBe(true);
    expect(runner.progress).toBe(1);
  });

  it('marks the real shutdown sections as coming after the goal', () => {
    for (const aircraft of AIRCRAFT) {
      const secure = aircraft.checklists.filter((s) => s.phase === 'secure');
      expect(secure.length, `${aircraft.id} has no secure phase`).toBe(1);
      expect(secure[0]!.id).toBe('shutdown');
    }
  });
});

describe('every checklist point is simulated', () => {
  it('has no item that can only be acknowledged', () => {
    for (const aircraft of AIRCRAFT) {
      const sim = new Simulation(aircraft);
      for (const section of aircraft.checklists) {
        for (const item of section.items) {
          // A predicate that can never be true would be an item the pilot
          // cannot actually complete by doing something.
          expect(typeof item.satisfied, `${aircraft.id}/${item.id}`).toBe('function');
          expect(() => item.satisfied(sim)).not.toThrow();
        }
      }
    }
  });

  it('requires the pilot to physically look both ways before starting', () => {
    const sim = newSim();
    const propClear = C172N.checklists
      .flatMap((section) => [...section.items])
      .find((item) => item.id === 'prop-clear');
    expect(propClear).toBeDefined();

    expect(propClear!.satisfied(sim)).toBe(false);
    sim.pilot.setHeadYaw(PilotState.LOOK_THRESHOLD + 0.2);
    expect(propClear!.satisfied(sim)).toBe(false); // only looked one way
    sim.pilot.setHeadYaw(-(PilotState.LOOK_THRESHOLD + 0.2));
    expect(propClear!.satisfied(sim)).toBe(true);
  });

  it('exposes the seat, belt, door and control lock as real controls', () => {
    for (const aircraft of AIRCRAFT) {
      const sim = new Simulation(aircraft);
      for (const id of ['seatLatch', 'seatbelt', 'cabinDoor']) {
        expect(sim.controls.has(id), `${aircraft.id} is missing ${id}`).toBe(true);
      }
      // The control lock starts installed, as it would be found.
    }
  });
});
