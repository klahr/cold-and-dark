import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChecklistRunner } from '../src/sim/Checklist';
import type { ChecklistItem, ChecklistSection } from '../src/aircraft/types';
import { shouldReveal, windowChecklist, type VrCardContent } from '../src/ui/VrChecklistCard';
import { installCanvasStub } from './canvasStub';
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

/**
 * A runner over a checklist of items that are satisfied the moment they are
 * reached, wound forward by `done` of them.
 *
 * The window is list arithmetic and has nothing to do with the aeroplane, so
 * these cases supply their own list rather than reaching into the runner to
 * shove it along. The runner has no such lever any more, and should not: an
 * overlay that could skip a step would be an overlay that could skip a step.
 */
function wound(done: number, perSection = 4): ChecklistRunner {
  const item = (id: string): ChecklistItem => ({
    id,
    callout: id.toUpperCase(),
    satisfied: () => true,
    why: '',
    hint: '',
  });
  const sections: ChecklistSection[] = [0, 1].map((n) => ({
    id: `s${n}`,
    title: `SECTION ${n}`,
    items: Array.from({ length: perSection }, (_, i) => item(`s${n}i${i}`)),
  }));

  const r = new ChecklistRunner(sections, newSim());
  // Each item needs the runner's dwell before it counts as done.
  for (let i = 0; i < done; i++) r.update(1);
  return r;
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
    // Four items done, so the current one is the first of the second section.
    const items = windowChecklist(wound(4), (i) => ({ text: i.callout }), 2, 3);

    expect(items.findIndex((i) => i.current)).toBe(2);
    expect(items[2]?.text).toBe('S1I0');
    // And the two above it are the tail of the section just finished.
    expect(items[0]?.text).toBe('S0I2');
    expect(items[1]?.text).toBe('S0I3');
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
    const r = wound(8);
    expect(r.position).toBeNull();

    const items = windowChecklist(r, (i) => ({ text: i.callout }), 2, 7);
    expect(items.some((i) => i.current)).toBe(false);
    expect(items[items.length - 1]?.text).toBe('S1I3');
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

/**
 * The board's help button.
 *
 * Nothing in the cockpit points at a control until it is asked for, and in a
 * headset the wrist board is the only place there is to ask from — so the
 * button has to be hittable when it is drawn and, just as importantly, has
 * to get out of the raycaster's way when it is not. A board that quietly
 * swallowed trigger pulls aimed at the switches behind it would be far worse
 * than one with no button at all.
 */
describe('the wrist board’s help button', () => {
  installCanvasStub();

  function content(button: string): VrCardContent {
    return {
      glyph: '\u{1F39B}\uFE0F',
      headline: 'Blandning — full',
      detail: 'Dra spaken hela vägen in.',
      button,
      progress: 0.2,
      stepLabel: '5 / 25',
      items: [],
      finished: false,
    };
  }

  it('is only in the raycaster’s way while it is offered', async () => {
    const { VrChecklistCard } = await import('../src/ui/VrChecklistCard');
    const camera = new THREE.PerspectiveCamera();
    const card = new VrChecklistCard();

    card.update(0.5, camera, content('Show me'));
    expect(card.buttonTarget.visible).toBe(true);

    card.update(0.5, camera, content(''));
    expect(card.buttonTarget.visible).toBe(false);

    // And a board that is not up at all offers nothing, whatever it last drew.
    card.update(0.5, camera, null);
    expect(card.buttonOffered).toBe(false);
  });

  it('puts the hit plane exactly where the button is drawn', async () => {
    const { VrChecklistCard, HELP_BUTTON } = await import('../src/ui/VrChecklistCard');
    const card = new VrChecklistCard();
    const geometry = card.buttonTarget.geometry as THREE.PlaneGeometry;

    // The board is 0.18 m across and drawn on a 768 px canvas, so the plane
    // should measure the button's pixels at that scale.
    const metresPerPx = 0.18 / 768;
    expect(geometry.parameters.width).toBeCloseTo(HELP_BUTTON.w * metresPerPx, 6);
    expect(geometry.parameters.height).toBeCloseTo(HELP_BUTTON.h * metresPerPx, 6);

    // Centred across the board, and at the pixel row it is drawn on: the
    // plane and the paint come from the same rectangle, so this is a
    // round trip rather than a restatement.
    const boardHeight = 0.18 * (960 / 768);
    expect(card.buttonTarget.position.x).toBeCloseTo(0, 6);
    expect(card.buttonTarget.position.y).toBeCloseTo(
      boardHeight / 2 - (HELP_BUTTON.y + HELP_BUTTON.h / 2) * metresPerPx,
      6,
    );
  });
});
