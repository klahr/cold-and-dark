import type { ControlDef } from '../../aircraft/types';
import type { FaultCode } from '../../sim/Faults';
import type { Simulation } from '../../sim/Simulation';
import type { ControlDescription } from '../overlay';
import copy from './sv.json' with { type: 'json' };

/**
 * Swedish for a six-year-old who can read.
 *
 * Every word on screen lives in `sv.json` beside this file; this module is
 * the typed way in, and the place where the rules behind the words are
 * written down. Editing the copy means editing the JSON — no TypeScript
 * involved — and a second language would be a second file of the same
 * shape.
 *
 * The checklist underneath is the POH's own, in POH English, and nothing is
 * dropped from it — a shorter list would teach a shorter procedure — but
 * every callout becomes a thing to *do*, and every "why" becomes one short
 * sentence with a reason a child cares about.
 *
 * Rules the copy follows, because they are what makes it readable at six:
 * short sentences, one instruction each; no subordinate clauses; concrete
 * nouns ("den röda knappen") over cockpit names ("mixture"); and the reason
 * always answers "what happens if I don't", never "what the system does".
 */
export interface KidStep {
  /** Picture cue, so the step is recognisable before it is read. */
  icon: string;
  /** What this step is, in three or four words. */
  title: string;
  /** How to physically do it. */
  action: string;
  /** Why it matters, in one sentence. */
  why: string;
}

/**
 * Fills `{name}` placeholders. The templates are in the JSON precisely so a
 * translator can move a number to where their language wants it, which a
 * string built by `+` in code would not allow.
 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Keyed by checklist item id. `tests/kid-copy.test.ts` asserts there is an
 * entry for every item of every registered aircraft, and nothing left over
 * for a step that no longer exists.
 */
export const KID_STEPS: Record<string, KidStep> = copy.steps;

export function kidStep(itemId: string): KidStep | null {
  return KID_STEPS[itemId] ?? null;
}

/**
 * Shown in place of a step with no copy of its own, so an untranslated item
 * is still actionable rather than blank.
 */
export const KID_UNKNOWN_STEP: KidStep = copy.unknownStep;

/* ------------------------------------------------------------------ */
/* Mistakes                                                            */
/* ------------------------------------------------------------------ */

export interface KidFault {
  title: string;
  message: string;
}

/**
 * The same faults the expert HUD shows, said kindly. A six-year-old who
 * floods the engine should hear what to do next, not what they did wrong,
 * so every message ends with the fix. `tests/kid-copy.test.ts` checks that
 * every code the simulation can raise has an entry here.
 */
export const KID_FAULTS: Record<FaultCode, KidFault> = copy.faults;

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/**
 * Swedish names for the things you can touch. A control with no entry gets
 * no tooltip in kid mode at all: an English cockpit label popping up beside
 * a Swedish instruction is worse than silence.
 */
export const KID_CONTROL_NAMES: Record<string, string> = copy.controls.names;

/**
 * Toggles whose two positions are not "on" and "off".
 *
 * A door is shut or open, a belt is done up or undone, a seat lock is locked
 * or not; none of the three is *switched*. They are toggles only as far as
 * the simulation is concerned, and "Dörren: AV" is the kind of thing that
 * reads as correct to whoever wrote the switch code and as nonsense to the
 * six-year-old the screen is for. These three are also the first three steps
 * on the list, so they are the first Swedish anyone reads here.
 */
const TOGGLE_WORDS: Record<string, { off: string; on: string }> = copy.controls.toggleWords;

/** Hover read-out in kid mode, or null for anything without a Swedish name. */
export function describeControlInSwedish(
  def: ControlDef,
  sim: Simulation,
): ControlDescription | null {
  const c = copy.controls;
  const name = def.id.startsWith('brk') ? c.breakerName : KID_CONTROL_NAMES[def.id];
  if (!name) return null;

  const v = sim.controls.num(def.id);
  switch (def.kind) {
    case 'toggle': {
      const words = TOGGLE_WORDS[def.id] ?? c.toggle;
      return { title: name, value: v > 0.5 ? words.on : words.off };
    }
    case 'breaker':
      return { title: name, value: v > 0.5 ? c.breaker.in : c.breaker.out };
    case 'selector':
    case 'key':
      return { title: name, value: sim.controls.pos(def.id) };
    case 'wheel':
      return { title: name, value: fill(c.wheel, { percent: Math.round(v * 100) }) };
    case 'pushPull':
      if (def.id === 'primer') {
        const n = sim.fuel.primerStrokes;
        const template = n === 0 ? c.primer.none : n === 1 ? c.primer.one : c.primer.many;
        return { title: name, value: fill(template, { n }) };
      }
      return { title: name, value: pushPullInSwedish(def.id, v) };
  }
}

function pushPullInSwedish(id: string, v: number): string {
  const words = copy.controls.pushPull;
  if (id === 'mixture') {
    if (v > 0.95) return words.mixture.in;
    if (v < 0.1) return words.mixture.out;
    return words.mixture.part;
  }
  if (id === 'throttle') {
    if (v < 0.03) return words.throttle.out;
    if (v > 0.95) return words.throttle.in;
    return words.throttle.part;
  }
  // The only one that reads backwards: a parking brake is *on* when its
  // knob is pulled out, so the low value is the set one.
  if (id === 'parkingBrake') return v < 0.3 ? words.parkingBrake.in : words.parkingBrake.out;
  if (v > 0.9) return words.default.in;
  if (v < 0.1) return words.default.out;
  return words.default.part;
}

/* ------------------------------------------------------------------ */
/* The welcome card                                                    */
/* ------------------------------------------------------------------ */

/**
 * The first words anyone reads here — and the whole premise is that they are
 * read by a six-year-old with nobody sitting beside them. So it answers only
 * the three questions someone has before they have touched anything: what is
 * this, what do I do, and what happens if I do it. Then one button out.
 *
 * Two things it deliberately does not say. It does not promise flying: this
 * aeroplane never leaves the ground, and a first sentence the trainer cannot
 * keep is worse than no first sentence. And it does not explain the help
 * button, because the card offers that itself once somebody is actually
 * stuck — a list of things to do when it goes wrong is a strange way to open
 * for a child who has not yet gone wrong.
 */
export const KID_WELCOME = copy.welcome;

/* ------------------------------------------------------------------ */
/* Everything else on screen                                           */
/* ------------------------------------------------------------------ */

/**
 * The screen's own words. The three entries that take a value are functions
 * over a `{placeholder}` template in the JSON, so call sites are unchanged
 * by the move out of TypeScript.
 */
export const KID_UI = {
  ...copy.ui,
  stepOf: (n: number, total: number): string => fill(copy.ui.stepOf, { n, total }),
  wrongControl: (wanted: string): string => fill(copy.ui.wrongControl, { wanted }),
  faultToast: (title: string): string => fill(copy.ui.faultToast, { title }),
} as const;

/**
 * The printed sheet.
 *
 * Paper mode takes the words off the screen, so the paper has to carry
 * everything the card would have said — including the reason, which on
 * screen lives behind the *Varför då?* button and on paper has nowhere else
 * to be.
 *
 * `disclaimer` is on the sheet at all because a printed page headed with an
 * aeroplane's name and a column of tick boxes looks exactly like the real
 * thing.
 */
export const KID_SHEET = {
  ...copy.sheet,
  fileName: (aircraftId: string): string => fill(copy.sheet.fileName, { aircraft: aircraftId }),
} as const;

/** Section headings, in the same plain Swedish as the steps. */
export function sectionName(sectionId: string): string {
  if (sectionId === 'before-start') return KID_UI.sectionBefore;
  if (sectionId === 'shutdown') return KID_UI.sectionSecure;
  return KID_UI.sectionStart;
}

/** Rotated so the hundredth tick still feels like someone noticed. */
export const KID_PRAISE: readonly string[] = copy.praise;
