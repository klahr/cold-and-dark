import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft/registry';
import { KID_FAULTS, KID_STEPS, kidStep } from '../src/ui/kid/swedish';

/**
 * The kid UI shows every item of the real checklist, so a step with no
 * Swedish copy is a step a six-year-old is handed in English — or, worse,
 * a placeholder. Adding an aircraft or a checklist item has to fail here
 * until the child-facing words exist too.
 */
const ALL_ITEM_IDS = [
  ...new Set(
    AIRCRAFT.flatMap((a) => a.checklists.flatMap((s) => s.items.map((i) => i.id))),
  ),
];

describe('Swedish kid copy', () => {
  it('covers every checklist item of every aircraft', () => {
    const missing = ALL_ITEM_IDS.filter((id) => kidStep(id) === null);
    expect(missing).toEqual([]);
  });

  it('has no copy for steps that no aircraft asks for', () => {
    const orphans = Object.keys(KID_STEPS).filter((id) => !ALL_ITEM_IDS.includes(id));
    expect(orphans).toEqual([]);
  });

  it('gives each step an icon, something to do and a reason', () => {
    for (const id of ALL_ITEM_IDS) {
      const step = kidStep(id);
      expect(step, id).not.toBeNull();
      expect(step?.icon.length, id).toBeGreaterThan(0);
      expect(step?.title.length, id).toBeGreaterThan(0);
      expect(step?.action.length, id).toBeGreaterThan(0);
      expect(step?.why.length, id).toBeGreaterThan(0);
    }
  });

  /**
   * Long sentences are where a confident six-year-old reader stops being
   * confident. This is a blunt proxy, but it catches copy drifting back
   * towards the POH phrasing it was written to replace.
   */
  it('keeps sentences short enough to read aloud', () => {
    for (const id of ALL_ITEM_IDS) {
      const step = kidStep(id);
      if (!step) continue;
      for (const text of [step.action, step.why]) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          const words = sentence.trim().split(/\s+/).filter(Boolean).length;
          expect(words, `${id}: "${sentence}"`).toBeLessThanOrEqual(20);
        }
      }
      expect(step.title.split(/\s+/).length, id).toBeLessThanOrEqual(6);
    }
  });

  it('explains every fault a child can cause', () => {
    for (const [code, fault] of Object.entries(KID_FAULTS)) {
      expect(fault.title.length, code).toBeGreaterThan(0);
      expect(fault.message.length, code).toBeGreaterThan(0);
      // Every message has to end with what to do next, not what went wrong.
      expect(fault.message.length, code).toBeGreaterThan(fault.title.length);
    }
  });
});
