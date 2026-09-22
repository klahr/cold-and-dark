import type { AircraftDefinition, ChecklistItem } from '../../aircraft/types';
import { A4, PdfDocument } from '../pdf/PdfDocument';
import { KID_SHEET, kidStep, sectionName } from './swedish';
import { drawIcon } from './icons';

/**
 * The checklist, as something you can hold.
 *
 * Paper mode exists because a six-year-old reading a step off a screen is
 * looking at the screen, and everything worth looking at is in the cockpit.
 * Once the words are on paper the screen can stop being a place to read and
 * go back to being the aeroplane — so this sheet has to be complete on its
 * own. It carries the reason for every step, which on screen is behind a
 * button, because on paper there is no button to put it behind.
 *
 * Deliberately not on it: the emoji. A PDF that stuck to the fourteen
 * standard fonts needs nothing embedded, and an emoji would mean carrying a
 * font — so the step number is what matches a row of paper to the card on
 * screen, and paper mode puts that same number on the card.
 */

/**
 * Step numbers, flat across the sections, one to twenty-four.
 *
 * Shared with the card on screen rather than counted again there: the number
 * is the only thing tying a row of paper to the step in front of the child,
 * and two independent counts that agree today would not have to agree after
 * the next checklist item is added.
 */
export function stepNumbers(aircraft: AircraftDefinition): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const section of aircraft.checklists) {
    for (const item of section.items) numbers.set(item.id, (n += 1));
  }
  return numbers;
}

const MARGIN = 48;
const TOP = 54;
const BOTTOM = 48;

/** Left columns: tick box, number, picture, then everything else. */
const BOX = 13;
const NUMBER_RIGHT = MARGIN + 38;
const ICON = 28;
const ICON_X = MARGIN + 44;
const TEXT_X = ICON_X + ICON + 10;

const INK: readonly [number, number, number] = [0.09, 0.11, 0.15];
const QUIET: readonly [number, number, number] = [0.42, 0.45, 0.5];
const RULE: readonly [number, number, number] = [0.8, 0.82, 0.85];
/** Legible, but plainly secondary to the Swedish beside it. */
const CALLOUT: readonly [number, number, number] = [0.58, 0.61, 0.66];

const TITLE_SIZE = 11.5;
const ACTION_SIZE = 10;
const WHY_SIZE = 8.5;

export function buildChecklistSheet(aircraft: AircraftDefinition): Uint8Array<ArrayBuffer> {
  const doc = new PdfDocument();
  const textWidth = A4.width - TEXT_X - MARGIN;

  const numbers = stepNumbers(aircraft);
  let y = 0;

  const newPage = (): void => {
    doc.addPage();
    y = TOP;
  };

  /** Room left before the footer. */
  const fits = (height: number): boolean => y + height <= A4.height - BOTTOM;

  newPage();

  /* ------------------------------ heading ----------------------------- */
  const full = A4.width - MARGIN * 2;
  y += 24;
  doc.text(aircraft.name, MARGIN, y, { font: 'bold', size: 24, colour: INK });
  y += 19;
  doc.text(KID_SHEET.subtitle, MARGIN, y, { size: 11, colour: QUIET });
  y += 20;
  for (const line of doc.wrap(KID_SHEET.howTo, 9.5, 'regular', full)) {
    doc.text(line, MARGIN, y, { size: 9.5, colour: QUIET });
    y += 12;
  }
  y += 4;
  for (const line of doc.wrap(KID_SHEET.disclaimer, 8, 'oblique', full)) {
    doc.text(line, MARGIN, y, { font: 'oblique', size: 8, colour: CALLOUT });
    y += 10;
  }
  y += 8;

  /* ------------------------------ the list ---------------------------- */
  for (const section of aircraft.checklists) {
    const heading = sectionName(section.id);
    if (!fits(46)) newPage();
    y += 8;
    doc.line(MARGIN, y, A4.width - MARGIN, y, { colour: RULE, lineWidth: 0.75 });
    y += 17;
    doc.text(heading.toUpperCase(), MARGIN, y, { font: 'bold', size: 12, colour: INK });
    y += 16;

    for (const item of section.items) {
      const block = measure(doc, item, textWidth);
      if (!fits(block)) newPage();
      drawItem(doc, item, numbers.get(item.id) ?? 0, y, textWidth);
      y += block + 9;
    }
  }

  return doc.toBytes();
}

/** Height of one item's block, so it is never split across a page break. */
function measure(doc: PdfDocument, item: ChecklistItem, textWidth: number): number {
  const step = kidStep(item.id);
  if (!step) return 0;
  const action = doc.wrap(step.action, ACTION_SIZE, 'regular', textWidth);
  const why = doc.wrap(`${KID_SHEET.why} ${step.why}`, WHY_SIZE, 'oblique', textWidth);
  const words = 14 + action.length * 12 + 3 + why.length * 10.5;
  // Never shorter than the picture beside it, or two icons would touch.
  return Math.max(words, ICON + 4);
}

function drawItem(
  doc: PdfDocument,
  item: ChecklistItem,
  number: number,
  top: number,
  textWidth: number,
): void {
  const step = kidStep(item.id);
  if (!step) return;

  // The tick box sits on the title's own line, a shade above the baseline so
  // it reads as belonging to that line rather than floating between two.
  doc.rect(MARGIN, top - BOX + 3, BOX, BOX, { stroke: INK, lineWidth: 1.1 });
  // Right-aligned, so a two-digit step does not shunt the picture across.
  const label = String(number);
  doc.text(label, NUMBER_RIGHT - doc.widthOf(label, 11, 'bold'), top, {
    font: 'bold',
    size: 11,
    colour: QUIET,
  });
  // The picture hangs a little above the title's baseline so it sits across
  // the title and the instruction, which is the pair it belongs to.
  drawIcon(doc, step.icon, ICON_X, top - 11, ICON);
  doc.text(step.title, TEXT_X, top, { font: 'bold', size: TITLE_SIZE, colour: INK });

  // The POH's own callout, small and out of the way on the right. The sheet
  // is the child's, but the aeroplane underneath is nobody's toy, and a
  // grown-up holding this should be able to see what the real line says.
  const callout = item.callout;
  const calloutWidth = doc.widthOf(callout, 7.5);
  const titleEnd = TEXT_X + doc.widthOf(step.title, TITLE_SIZE, 'bold');
  if (A4.width - MARGIN - calloutWidth > titleEnd + 14) {
    doc.text(callout, A4.width - MARGIN - calloutWidth, top, { size: 7.5, colour: CALLOUT });
  }

  let y = top + 14;
  for (const line of doc.wrap(step.action, ACTION_SIZE, 'regular', textWidth)) {
    doc.text(line, TEXT_X, y, { size: ACTION_SIZE, colour: INK });
    y += 12;
  }
  y += 3;
  for (const line of doc.wrap(`${KID_SHEET.why} ${step.why}`, WHY_SIZE, 'oblique', textWidth)) {
    doc.text(line, TEXT_X, y, { font: 'oblique', size: WHY_SIZE, colour: QUIET });
    y += 10.5;
  }
}

/**
 * Hands the sheet to the browser as a download.
 *
 * Nothing leaves the machine: the bytes were built here, and the object URL
 * is revoked on the next turn of the event loop.
 */
export function downloadChecklistSheet(aircraft: AircraftDefinition): void {
  const blob = new Blob([buildChecklistSheet(aircraft)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = KID_SHEET.fileName(aircraft.id);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
