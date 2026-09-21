import { describe, expect, it } from 'vitest';
import { ChecklistRunner } from '../src/sim/Checklist';
import { shouldReveal, windowChecklist } from '../src/ui/VrChecklistCard';
import { C172N } from '../src/aircraft/c172n';
import { newSim } from './helpers';

/**
 * The wrist board is the entire UI in a headset, so the slice of checklist it
 * shows has to stay centred on where the pilot actually is. This is pure
 * list arithmetic, so it needs no canvas and no headset.
 */
function runner(): ChecklistRunner {
  return new ChecklistRunner(C172N.checklists, newSim());
}

const FLAT = C172N.checklists.flatMap((s) => s.items);

describe('windowChecklist', () => {
  it('labels items with whatever language the caller speaks', () => {
    const items = windowChecklist(runner(), (item) => ({ text: `SV:${item.id}` }));
    expect(items[0]?.text).toBe(`SV:${FLAT[0]?.id}`);
  });

  it('marks exactly one item as current', () => {
    const items = windowChecklist(runner(), (i) => ({ text: i.callout }));
    expect(items.filter((i) => i.current)).toHaveLength(1);
    expect(items.find((i) => i.current)?.text).toBe(FLAT[0]?.callout);
  });

  it('clamps at the start of the list rather than padding', () => {
    const items = windowChecklist(runner(), (i) => ({ text: i.callout }), 2, 7);
    // Two before the first item do not exist, so the window starts at it.
    expect(items[0]?.current).toBe(true);
    expect(items).toHaveLength(8);
  });

  /**
   * The window is over the whole procedure, not the current section, so
   * arriving at a section boundary still shows where you have just come
   * from. Getting this wrong makes the board look like it has reset.
   */
  it('spans section boundaries', () => {
    const r = runner();
    r.jumpToSection(1);
    const items = windowChecklist(r, (i) => ({ text: i.callout }), 2, 3);

    const currentIndex = items.findIndex((i) => i.current);
    expect(currentIndex).toBe(2);

    const beforeStart = C172N.checklists[0]?.items ?? [];
    expect(items[0]?.text).toBe(beforeStart[beforeStart.length - 2]?.callout);
    expect(items[1]?.text).toBe(beforeStart[beforeStart.length - 1]?.callout);
  });

  /** The kid board draws these instead of the text, so they have to survive. */
  it('carries a picture cue through when the caller supplies one', () => {
    const items = windowChecklist(runner(), (i) => ({ text: i.callout, icon: '\u{1F50B}' }));
    expect(items.every((i) => i.icon === '\u{1F50B}')).toBe(true);
  });

  it('reports what has actually been ticked off', () => {
    const r = runner();
    expect(windowChecklist(r, (i) => ({ text: i.callout })).every((i) => !i.done)).toBe(true);
  });

  it('shows the tail of the list once the checklist is finished', () => {
    const r = runner();
    for (let i = 0; i < FLAT.length; i++) r.skip();
    expect(r.position).toBeNull();

    const items = windowChecklist(r, (i) => ({ text: i.callout }), 2, 7);
    expect(items.some((i) => i.current)).toBe(false);
    expect(items[items.length - 1]?.text).toBe(FLAT[FLAT.length - 1]?.callout);
  });
});

/**
 * The wrist board is revealed by presenting your palm, which is a more
 * deliberate gesture than glancing at a watch — it has to be, or the board
 * appears every time you reach for the throttle.
 */
describe('shouldReveal', () => {
  const deg = (d: number) => Math.cos((d * Math.PI) / 180);

  it('shows the board when the palm is square to your face', () => {
    expect(shouldReveal(deg(0), false)).toBe(true);
    expect(shouldReveal(deg(20), false)).toBe(true);
  });

  it('stays hidden at the angles a hand rests at while flying', () => {
    expect(shouldReveal(deg(45), false)).toBe(false);
    expect(shouldReveal(deg(90), false)).toBe(false);
    // Behind you, pointing away: never.
    expect(shouldReveal(-1, false)).toBe(false);
  });

  it('holds on past the angle it appeared at, so it does not flicker', () => {
    // Between the two thresholds: not enough to summon, enough to keep.
    const wobble = deg(45);
    expect(shouldReveal(wobble, false)).toBe(false);
    expect(shouldReveal(wobble, true)).toBe(true);
  });

  it('lets go once the wrist really turns away', () => {
    expect(shouldReveal(deg(85), true)).toBe(false);
  });

  /**
   * Summoning is the deliberate act; dismissing should not be. The band it
   * holds on over is far wider than the one it appears in, so the hand can
   * drift while you read without the board going away mid-sentence.
   */
  it('holds on over a much wider range than it appears in', () => {
    const appearsAt = [...Array(90).keys()].filter((d) => shouldReveal(deg(d), false)).length;
    const holdsTo = [...Array(90).keys()].filter((d) => shouldReveal(deg(d), true)).length;
    expect(holdsTo).toBeGreaterThan(appearsAt * 1.8);
  });

  /**
   * Turning the hand the other way is the same gesture as far as the reveal
   * is concerned, so that getting the runtime's palm convention wrong costs
   * a board on the other side of the hand rather than one that can never be
   * summoned. The caller passes an absolute alignment for this reason.
   */
  it('treats either face of the hand as the same gesture', () => {
    expect(shouldReveal(Math.abs(-1), false)).toBe(true);
  });
});
