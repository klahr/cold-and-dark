import { describe, expect, it } from 'vitest';
import { buildChecklistSheet, stepNumbers } from '../src/ui/kid/checklistSheet';
import { PdfDocument } from '../src/ui/pdf/PdfDocument';
import { KID_SHEET, KID_STEPS, kidStep } from '../src/ui/kid/swedish';
import { drawIcon, hasIcon } from '../src/ui/kid/icons';
import { C172N } from '../src/aircraft/c172n';
import { AIRCRAFT } from '../src/aircraft/registry';

/**
 * The printed sheet.
 *
 * Paper mode takes the words off the screen, so anything missing from the
 * PDF is missing from the child's world entirely — there is nowhere else
 * left to read it. Hence the coverage test below, which is the same promise
 * `kid-copy.test.ts` makes about the screen.
 *
 * The file is written by hand rather than by a library, so the structure is
 * worth checking too: a cross-reference table pointing at the wrong byte is
 * not a layout glitch, it is a reader refusing to open the document at all,
 * and it is exactly the kind of thing that breaks when a page is added.
 */

/** The bytes as the one-byte-per-character text they are. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const SHEET = buildChecklistSheet(C172N);
const TEXT = latin1(SHEET);

describe('the printed checklist', () => {
  it('is a PDF', () => {
    expect(TEXT.startsWith('%PDF-1.4')).toBe(true);
    expect(TEXT.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  /**
   * Every offset in the table must land exactly on the object it claims.
   * This is what a reader does first, and the only thing standing between a
   * one-line layout change and a file nobody can open.
   */
  it('has a cross-reference table that points at its objects', () => {
    const startxref = Number(/startxref\s+(\d+)/.exec(TEXT)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);
    expect(TEXT.slice(startxref, startxref + 4)).toBe('xref');

    const header = /xref\s+0 (\d+)\s/.exec(TEXT.slice(startxref));
    const count = Number(header?.[1]);
    expect(count).toBeGreaterThan(5);

    const entries = [...TEXT.slice(startxref).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
    expect(entries).toHaveLength(count);

    entries.forEach((entry, id) => {
      if (entry[3] === 'f') return;
      const offset = Number(entry[1]);
      expect(TEXT.slice(offset, offset + `${id} 0 obj`.length), `object ${id}`).toBe(
        `${id} 0 obj`,
      );
    });

    // And the trailer agrees with the table it follows.
    expect(/\/Size (\d+)/.exec(TEXT)?.[1]).toBe(String(count));
  });

  it('declares as many pages as it draws', () => {
    const declared = Number(/\/Type \/Pages .*\/Count (\d+)/.exec(TEXT)?.[1]);
    const drawn = [...TEXT.matchAll(/\/Type \/Page[^s]/g)].length;
    expect(drawn).toBe(declared);
    expect(declared).toBeGreaterThan(1);
  });

  /**
   * The point of the sheet. A step whose words never reached the paper is a
   * step a child in paper mode cannot do at all.
   */
  it('carries every step, with its instruction and its reason', () => {
    const missing: string[] = [];
    for (const section of C172N.checklists) {
      for (const item of section.items) {
        const step = kidStep(item.id);
        if (!step) continue;
        // Wrapping breaks lines, so check on the longest unbroken run.
        for (const [label, text] of [
          ['title', step.title],
          ['action', step.action],
          ['why', step.why],
        ] as const) {
          const longest = text.split(/\s+/).reduce((a, b) => (a.length >= b.length ? a : b));
          if (!TEXT.includes(longest)) missing.push(`${item.id} ${label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The card leads with a picture because at six it is recognised well
   * before the sentence under it is read, and a sheet of nothing but Swedish
   * sentences asks for exactly the reading the screen avoids. A step whose
   * emoji has no drawing would print a blank tile.
   */
  it('has a drawing for every step picture', () => {
    const missing = new Set<string>();
    for (const section of C172N.checklists) {
      for (const item of section.items) {
        const step = kidStep(item.id);
        if (step && !hasIcon(step.icon)) missing.add(`${item.id}: ${step.icon}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  /**
   * A page headed with an aeroplane's name and a column of tick boxes looks
   * exactly like the real thing, so it has to say that it is not.
   */
  it('says under the heading that it is not a real checklist', () => {
    const longest = KID_SHEET.disclaimer
      .split(/\s+/)
      .reduce((a, b) => (a.length >= b.length ? a : b));
    expect([...TEXT.matchAll(new RegExp(longest, 'g'))]).toHaveLength(1);
  });

  /** The heading is the aeroplane, so it is right for whatever is printed. */
  it('is headed with the aircraft it belongs to', () => {
    for (const aircraft of AIRCRAFT) {
      const text = latin1(buildChecklistSheet(aircraft));
      expect(text, aircraft.id).toContain(aircraft.name);
      // Either side of the em dash: in the file that dash is a WinAnsi byte,
      // not the character this source string holds.
      for (const half of KID_SHEET.subtitle.split('\u2014')) {
        expect(text, aircraft.id).toContain(half.trim());
      }
    }
  });

  /**
   * The number on the card and the number on the paper are the same number,
   * because finding your row is the only thing the card is for once the
   * words are printed.
   */
  it('numbers every step exactly once, in list order', () => {
    for (const aircraft of AIRCRAFT) {
      const numbers = stepNumbers(aircraft);
      const ids = aircraft.checklists.flatMap((s) => s.items.map((i) => i.id));
      expect(numbers.size).toBe(ids.length);
      ids.forEach((id, i) => expect(numbers.get(id)).toBe(i + 1));
    }
  });

  /** Every aeroplane in the registry has to be printable, not just this one. */
  it('can be built for every registered aircraft', () => {
    for (const aircraft of AIRCRAFT) {
      expect(buildChecklistSheet(aircraft).length).toBeGreaterThan(1000);
    }
  });
});

describe('the PDF writer', () => {
  it('wraps inside the column it is given', () => {
    const doc = new PdfDocument();
    const words =
      'Motorn är kall och behöver lite extra bensin för att vakna innan den orkar gå själv';
    for (const width of [120, 240, 360]) {
      for (const line of doc.wrap(words, 10, 'regular', width)) {
        expect(doc.widthOf(line, 10), line).toBeLessThanOrEqual(width);
      }
    }
  });

  it('keeps every word', () => {
    const doc = new PdfDocument();
    const words = 'ett två tre fyra fem sex sju åtta nio tio elva tolv';
    expect(doc.wrap(words, 10, 'regular', 90).join(' ')).toBe(words);
  });

  /**
   * Swedish is the whole point, and an em dash that quietly became a
   * question mark is the kind of thing nobody notices until it is printed.
   */
  it('writes Swedish and the POH dash as WinAnsi bytes', () => {
    const doc = new PdfDocument();
    doc.addPage();
    doc.text('Lås fast stolen — SEATS', 20, 20);
    const text = latin1(doc.toBytes());
    expect(text).toContain('Lås fast stolen \u0097 SEATS');
    expect(text).not.toContain('?');
  });

  it('measures an accented letter as its plain one', () => {
    const doc = new PdfDocument();
    expect(doc.widthOf('å', 10)).toBeCloseTo(doc.widthOf('a', 10), 6);
    expect(doc.widthOf('Ö', 10)).toBeCloseTo(doc.widthOf('O', 10), 6);
  });

  /**
   * A missing pictogram still draws its tile, so "the icon appeared" is not
   * evidence of anything. What distinguishes them is the drawing on top.
   */
  it('draws a picture inside the tile, not just the tile', () => {
    const drawn = (emoji: string): number => {
      const doc = new PdfDocument();
      doc.addPage();
      drawIcon(doc, emoji, 10, 10, 40);
      return doc.toBytes().length;
    };
    const bare = drawn('\u{1F921}');
    for (const step of Object.values(KID_STEPS)) {
      expect(drawn(step.icon), step.icon).toBeGreaterThan(bare);
    }
  });

  it('draws an icon whether or not the emoji carries a variation selector', () => {
    // '\u2744' and '\u2744\uFE0F' are the same snowflake to a reader and
    // different strings to a Record lookup.
    expect(hasIcon('\u2744')).toBe(true);
    expect(hasIcon('\u2744\uFE0F')).toBe(true);
  });

  it('refuses to draw before there is a page', () => {
    expect(() => new PdfDocument().text('x', 0, 0)).toThrow();
  });
});
