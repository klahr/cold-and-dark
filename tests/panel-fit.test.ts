import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft/registry';
import { PANEL_HALF_H } from '../src/render/frame';
import { discFitsPanel, panelHalfWidthAt } from '../src/render/panelShape';
import { detentReach } from '../src/render/ControlObject';
import { RADIO_STACK_LAYOUT } from '../src/aircraft/shared/steamPanel';

/**
 * The panel has to fit inside the cabin, and everything on the panel has to
 * fit inside the panel.
 *
 * This is a regression test for a bug that was visible but whose cause was
 * not: the panel was authored as a 1.04 m rounded rectangle in a cabin that
 * measures about 0.95 m at panel height, so its outer corners were buried in
 * the sidewall. What the pilot actually saw was the *fuselage* covering the
 * left of the six-pack, because from the left seat the sightline to the far
 * corner of the panel passes through the lining.
 *
 * Checking it by eye does not work. The overhang was 2-4 cm on a panel a
 * metre wide, the occluded instrument was at the edge of the frame, and the
 * only view that showed it clearly was the one nobody takes. Arithmetic
 * catches it immediately.
 */
describe('panel fits the cabin', () => {
  it('narrows toward the top, following the fuselage', () => {
    const atMiddle = panelHalfWidthAt(0);
    const nearTop = panelHalfWidthAt(PANEL_HALF_H - 0.02);
    expect(nearTop).toBeLessThan(atMiddle);
  });

  it('never exceeds the cabin', () => {
    // The lining's inner surface at panel height. Anything wider than this is
    // inside the wall.
    for (let y = -PANEL_HALF_H; y <= PANEL_HALF_H; y += 0.01) {
      expect(panelHalfWidthAt(y)).toBeLessThan(0.48);
      expect(panelHalfWidthAt(y)).toBeGreaterThan(0.2);
    }
  });

  for (const aircraft of AIRCRAFT) {
    describe(aircraft.id, () => {
      it('every panel instrument fits inside the panel outline', () => {
        const offenders: string[] = [];
        for (const instrument of aircraft.instruments) {
          const mount = instrument.mount;
          if (mount.frame !== undefined && mount.frame !== 'panel') continue;
          const radius = instrument.size / 2;
          // `size` is a case diameter for round instruments but a plate width
          // for clusters like the engine gauges and the audio panel, which are
          // much wider than they are tall. Treating those as discs reports a
          // top-edge overhang that does not exist, so they are checked on
          // horizontal extent only.
          const isRoundCase = instrument.size <= 0.1;
          const fits = isRoundCase
            ? // Bezels stand proud of the case, so allow for the rim as well.
              discFitsPanel(mount.x, mount.y, radius + 0.004)
            : Math.abs(mount.x) + radius <= panelHalfWidthAt(mount.y);
          if (!fits) {
            offenders.push(
              `${instrument.id} at (${mount.x}, ${mount.y}) r=${radius.toFixed(4)} ` +
                `needs ${(Math.abs(mount.x) + radius).toFixed(3)}, ` +
                `panel allows ${panelHalfWidthAt(mount.y).toFixed(3)}`,
            );
          }
        }
        expect(offenders).toEqual([]);
      });

      it('every panel control sits inside the panel outline', () => {
        const offenders: string[] = [];
        for (const control of aircraft.controls) {
          const mount = control.mount;
          if (mount.frame !== undefined && mount.frame !== 'panel') continue;
          // Controls are small; a 25 mm allowance covers knob and lever bodies.
          if (!discFitsPanel(mount.x, mount.y, 0.025)) {
            offenders.push(
              `${control.id} at (${mount.x}, ${mount.y}), ` +
                `panel allows ${panelHalfWidthAt(mount.y).toFixed(3)}`,
            );
          }
        }
        expect(offenders).toEqual([]);
      });

      it('every placard sits inside the panel outline', () => {
        const offenders: string[] = [];
        for (const placard of aircraft.placards ?? []) {
          // Rough half-length of the rendered text, which is tracked wide.
          const halfLength = placard.text.length * (placard.size ?? 0.0048) * 0.42;
          const reach = Math.abs(placard.x) + halfLength;
          if (reach > panelHalfWidthAt(placard.y)) {
            offenders.push(
              `"${placard.text}" reaches ${reach.toFixed(3)}, ` +
                `panel allows ${panelHalfWidthAt(placard.y).toFixed(3)}`,
            );
          }
        }
        expect(offenders).toEqual([]);
      });
    });
  }
});

/**
 * A rotary is as wide as its lettering, not as wide as its knob.
 *
 * The checks above measure controls by their own radius, which says nothing
 * about the ring of position names around a selector or an ignition switch.
 * Those were made larger and brighter to be readable in the shadow under the
 * panel, and growing them is exactly the change that pushes them off the
 * edge or onto a neighbour without anything failing.
 */
describe('rotary lettering', () => {
  for (const aircraft of AIRCRAFT) {
    const rotaries = aircraft.controls.filter(
      (c): c is Extract<typeof c, { kind: 'selector' | 'key' }> =>
        (c.kind === 'selector' || c.kind === 'key') &&
        (c.mount.frame ?? 'panel') === 'panel',
    );

    it(`${aircraft.id}: detent names stay on the panel`, () => {
      for (const control of rotaries) {
        const reach = detentReach(control);
        expect(
          Math.abs(control.mount.x) + reach,
          `${control.id} reaches ${(Math.abs(control.mount.x) + reach).toFixed(3)}`,
        ).toBeLessThanOrEqual(panelHalfWidthAt(control.mount.y));
      }
    });

    it(`${aircraft.id}: detent names do not run into a neighbouring control`, () => {
      for (const control of rotaries) {
        const reach = detentReach(control);
        for (const other of aircraft.controls) {
          if (other.id === control.id) continue;
          if ((other.mount.frame ?? 'panel') !== 'panel') continue;
          const gap = Math.hypot(
            other.mount.x - control.mount.x,
            other.mount.y - control.mount.y,
          );
          expect(gap, `${control.id} lettering overlaps ${other.id}`).toBeGreaterThan(reach * 0.62);
        }
      }
    });
  }
});


/**
 * The radio stack is a rack of boxes bolted one under the next, so the gaps
 * between them have to be equal — and hand-placed they had drifted to 3, 5,
 * 2, 11 and 11 mm: the top four almost touching while the bottom two
 * floated. Each unit's height comes from its own proportions, so this is
 * exactly the sort of thing that goes quietly wrong again when one is added.
 */
describe('radio stack', () => {
  it('stacks six units in one column', () => {
    expect(RADIO_STACK_LAYOUT.length).toBe(6);
    const instruments = AIRCRAFT[0]!.instruments;
    const inStack = instruments.filter((i) => RADIO_STACK_LAYOUT.some((u) => u.id === i.id));
    expect(inStack.length).toBe(6);
    expect(new Set(inStack.map((i) => i.mount.x)).size).toBe(1);
    expect(new Set(inStack.map((i) => i.size)).size).toBe(1);
  });

  it('leaves the same gap between every unit', () => {
    const ordered = [...RADIO_STACK_LAYOUT].sort((a, b) => b.y - a.y);
    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const above = ordered[i - 1]!;
      const below = ordered[i]!;
      gaps.push(above.y - above.height / 2 - (below.y + below.height / 2));
    }
    const printed = gaps.map((g) => (g * 1000).toFixed(1)).join(', ');
    for (const gap of gaps) {
      expect(gap, `gaps: ${printed} mm`).toBeCloseTo(gaps[0]!, 6);
      // Bolted into a rack, not scattered down the panel.
      expect(gap, `gaps: ${printed} mm`).toBeGreaterThan(0);
      expect(gap, `gaps: ${printed} mm`).toBeLessThan(0.008);
    }
  });

  it('keeps the whole rack on the panel', () => {
    const ordered = [...RADIO_STACK_LAYOUT].sort((a, b) => b.y - a.y);
    const top = ordered[0]!;
    const bottom = ordered[ordered.length - 1]!;
    expect(top.y + top.height / 2).toBeLessThan(PANEL_HALF_H);
    expect(bottom.y - bottom.height / 2).toBeGreaterThan(-PANEL_HALF_H);
  });
});
