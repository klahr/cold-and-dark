import type { AircraftDefinition, ChecklistItem } from '../../aircraft/types';
import type { Simulation } from '../../sim/Simulation';
import type { Fault } from '../../sim/Faults';
import { ChecklistRunner } from '../../sim/Checklist';
import type { ControlDescription, HudCallbacks } from '../overlay';
import { windowChecklist, type VrCardContent } from '../VrChecklistCard';
import type { VrSupport } from '../../input/VrSession';
import { KID_FAULTS, KID_PRAISE, KID_UI, kidStep, sectionName, type KidStep } from './swedish';
import { downloadChecklistSheet, stepNumbers } from './checklistSheet';
import { el } from './dom';

/** Seconds on one step before the UI offers to point at the control. */
const STUCK_AFTER = 15;

/** Fallback copy, so an untranslated item is still actionable rather than blank. */
const UNKNOWN: KidStep = {
  icon: '✈️',
  title: 'Nästa steg',
  action: 'Titta på den sak som lyser i cockpiten och klicka på den.',
  why: 'Varje steg gör planet lite mer redo att flyga.',
};


/**
 * The overlay: Swedish, for a child who can read.
 *
 * It runs the real checklist, every item of it, against the real simulation.
 * The aeroplane is not made easier — a flooded engine still has to be
 * cleared by the book — and nothing about the procedure is dropped. What is
 * built for a six-year-old is everything *around* the aeroplane: one step on
 * screen at a time in words they can act on, help that arrives only when
 * they ask for it, and a mistake answered with what to do next rather than
 * with what went wrong.
 *
 * Two deliberate omissions. There is no clock, because a clock turns a first
 * attempt into a test. And there is no systems read-out, because a child who
 * cannot yet read "suction 4.8 inHg" only learns that part of the screen is
 * not for them.
 */
export class KidHud {
  readonly checklist: ChecklistRunner;

  private readonly root: HTMLElement;
  private readonly sim: Simulation;
  private readonly callbacks: HudCallbacks;

  private readonly chipEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly actionEl: HTMLElement;
  private readonly whyEl: HTMLElement;
  private readonly stuckEl: HTMLElement;
  private readonly whyBtn: HTMLButtonElement;
  private readonly showBtn: HTMLButtonElement;
  private readonly shutdownBtn: HTMLButtonElement;
  private readonly cardEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly planeEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  /** The confetti layer. Nothing in it can be clicked. */
  private readonly finishEl: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly vrBtn: HTMLButtonElement;
  private readonly paperBtn: HTMLButtonElement;
  private readonly stepNoEl: HTMLElement;

  private readonly aircraft: AircraftDefinition;
  private readonly numbers: Map<string, number>;
  private readonly totalItems: number;
  /**
   * The list is on paper, so the screen stops being a place to read.
   *
   * A child reading a step off the screen is looking at the screen, and
   * everything worth looking at is in the cockpit. With the sheet printed
   * out, the card has one job left: saying which row of it you are on.
   */
  private paperMode = false;
  private lastItemId: string | null = null;
  private itemAge = 0;
  private praiseIndex = 0;
  private celebrated = false;
  /** Set once the child has pressed "Var är den?" for the current step. */
  private helpShown = false;
  private tooltipAt: { x: number; y: number } | null = null;

  constructor(
    root: HTMLElement,
    aircraft: AircraftDefinition,
    sim: Simulation,
    callbacks: HudCallbacks,
  ) {
    this.sim = sim;
    this.callbacks = callbacks;
    this.aircraft = aircraft;
    this.numbers = stepNumbers(aircraft);
    this.checklist = new ChecklistRunner(aircraft.checklists, sim);
    this.totalItems = aircraft.checklists.reduce((n, s) => n + s.items.length, 0);

    this.root = el('div', 'kid');

    /* ----------------------------- top bar ---------------------------- */
    const bar = el('div', 'kid-bar');
    const brand = el('div', 'kid-brand');
    brand.append(el('span', 'kid-brand-plane', '✈️'));
    const words = el('div');
    words.append(el('strong', undefined, KID_UI.title));
    words.append(el('span', undefined, KID_UI.subtitle));
    brand.append(words);
    bar.append(brand);

    const tools = el('div', 'kid-tools');
    this.soundBtn = this.toolButton('🔊', KID_UI.sound, () =>
      this.callbacks.onToggleSound(this.soundBtn.getAttribute('aria-pressed') !== 'true'),
    );
    tools.append(this.soundBtn);
    tools.append(this.toolButton('↺', KID_UI.reset, () => this.callbacks.onReset()));
    // Printing is a grown-up's errand, so it sits with the other grown-up
    // buttons rather than anywhere near the step.
    tools.append(this.toolButton('🖨️', KID_UI.print, () => downloadChecklistSheet(this.aircraft)));
    this.paperBtn = this.toolButton('📄', KID_UI.paper, () => this.setPaperMode(!this.paperMode));
    this.paperBtn.setAttribute('aria-pressed', 'false');
    tools.append(this.paperBtn);
    // Hidden until a headset is actually there. A disabled button explaining
    // a certificate problem is noise to a six-year-old, and the reasons a
    // headset might be unavailable are a grown-up's problem.
    this.vrBtn = this.toolButton('🥽', KID_UI.vr, () => this.callbacks.onEnterVr());
    this.vrBtn.hidden = true;
    tools.append(this.vrBtn);
    bar.append(tools);
    this.root.append(bar);

    /* ---------------------------- progress ---------------------------- */
    const track = el('div', 'kid-track');
    this.fillEl = el('i');
    this.planeEl = el('span', 'kid-plane', '✈️');
    // No count beside it. "0 / 24" is a number to a grown-up and a long way
    // to go to a child; the aeroplane moving along the bar says the same
    // thing without anyone having to read it.
    track.append(this.fillEl, this.planeEl);
    this.root.append(track);

    /* ------------------------------ card ------------------------------ */
    this.cardEl = el('section', 'kid-card');
    this.chipEl = el('div', 'kid-chip');
    const head = el('div', 'kid-head');
    // Drawn only in paper mode. Not a count of how far there is to go — the
    // reason there is no "3 / 24" anywhere on this screen — but the number
    // printed beside the same step on the sheet, so a child can find their
    // place on the paper without reading a word of it.
    this.stepNoEl = el('div', 'kid-stepno');
    this.iconEl = el('div', 'kid-icon');
    this.titleEl = el('h2', 'kid-what');
    head.append(this.stepNoEl, this.iconEl, this.titleEl);
    this.actionEl = el('p', 'kid-action');

    const acts = el('div', 'kid-acts');
    this.showBtn = el('button', 'kid-show', KID_UI.showMe);
    this.showBtn.type = 'button';
    this.showBtn.addEventListener('click', () => this.showMe());
    this.whyBtn = el('button', 'kid-why-btn', KID_UI.why);
    this.whyBtn.type = 'button';
    this.whyBtn.addEventListener('click', () => this.toggleWhy());
    acts.append(this.showBtn, this.whyBtn);

    // Its own row rather than one of the two step buttons, because those go
    // away in paper mode and this is the only way out of a running aeroplane.
    this.shutdownBtn = el('button', 'kid-shutdown', KID_UI.shutdown);
    this.shutdownBtn.type = 'button';
    this.shutdownBtn.hidden = true;
    this.shutdownBtn.addEventListener('click', () => this.startShutdown());

    this.whyEl = el('p', 'kid-why');
    this.whyEl.hidden = true;
    this.stuckEl = el('p', 'kid-stuck', KID_UI.stuck);
    this.stuckEl.hidden = true;

    this.cardEl.append(
      this.chipEl,
      head,
      this.actionEl,
      acts,
      this.shutdownBtn,
      this.whyEl,
      this.stuckEl,
    );
    this.root.append(this.cardEl);

    /* --------------------------- transient ---------------------------- */
    this.toastsEl = el('div', 'kid-toasts');
    this.root.append(this.toastsEl);

    this.tooltipEl = el('div', 'kid-tip');
    this.root.append(this.tooltipEl);

    this.finishEl = el('div', 'kid-finish');
    this.finishEl.hidden = true;
    this.root.append(this.finishEl);

    root.append(this.root);
    document.documentElement.lang = 'sv';

    this.sim.faults.onRaise((fault) => this.onFault(fault));
    this.checklist.onAdvance((item) => this.onItemComplete(item));

    this.render();
  }

  /* ------------------------------------------------------------------ */
  /* TrainerHud                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    this.checklist.update(dt);

    const pos = this.checklist.position;
    if ((pos?.item.id ?? null) !== this.lastItemId) {
      this.lastItemId = pos?.item.id ?? null;
      this.itemAge = 0;
      this.helpShown = false;
      this.render();
      // Finding the control is handled by the arrow in the scene, which
      // flies to it and waits. Moving the camera on their behalf is saved
      // for "Var är den?" below, where they actually asked for it.
    }

    this.itemAge += dt;
    // Not once they have asked: the nudge exists to offer the button, and
    // going on offering it after it has been pressed reads as the screen not
    // noticing.
    const stuck =
      pos !== null && !this.paperMode && !this.helpShown && this.itemAge > STUCK_AFTER;
    if (stuck === this.stuckEl.hidden) {
      this.stuckEl.hidden = !stuck;
      this.showBtn.classList.toggle('nudge', stuck);
    }

    if (!this.celebrated && this.checklist.goalReached) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  /**
   * Turns the on-screen words off.
   *
   * Only the screen: in a headset the wrist board keeps its full step, since
   * the premise of paper mode is a sheet in your hand and both of your hands
   * are holding controllers.
   */
  setPaperMode(on: boolean): void {
    if (on === this.paperMode) return;
    this.paperMode = on;
    this.root.classList.toggle('paper', on);
    this.paperBtn.setAttribute('aria-pressed', String(on));
    const name = on ? KID_UI.paperOn : KID_UI.paper;
    this.paperBtn.setAttribute('aria-label', name);
    this.paperBtn.title = name;
    // Said once, when it changes, rather than printed under every step.
    if (on) this.toast('wait', '📄', KID_UI.paperHint, '');
    this.render();
  }

  reset(): void {
    this.checklist.restart();
    this.lastItemId = null;
    this.itemAge = 0;
    this.helpShown = false;
    this.celebrated = false;
    this.finishEl.hidden = true;
    this.finishEl.replaceChildren();
    this.toastsEl.replaceChildren();
    this.render();
  }

  /**
   * A control the checklist is holding has been pressed. It has not moved —
   * that is the point — so the only thing left to do is say why, and the two
   * reasons want different words.
   *
   * A step still ahead gets pointed back at the one on screen, because the
   * child has almost certainly found the right switch too early rather than
   * the wrong switch. A step already behind gets told it is finished: at six
   * "it will not move" and "it is already done" feel like the same event, and
   * only one of them is good news.
   */
  onBlocked(id: string): void {
    // Nothing is being asked for during the hold, so there is no "first do
    // this" to point at — only the button that starts the shutdown.
    if (this.checklist.holding) {
      this.toast('wait', '🕐', KID_UI.notYetShutdown, '');
      return;
    }
    const reason = this.checklist.lockReason(id);
    if (reason === 'done') {
      this.toast('wait', '✅', KID_UI.alreadyDone, '');
      return;
    }
    const pos = this.checklist.position;
    if (reason !== 'not-yet' || !pos) return;
    const step = kidStep(pos.item.id) ?? UNKNOWN;
    this.toast('wait', '🕐', KID_UI.wrongControl(step.title), '');
  }

  showTooltip(description: ControlDescription | null, x: number, y: number): void {
    if (!description) {
      this.tooltipAt = null;
      this.tooltipEl.classList.remove('visible');
      return;
    }
    this.tooltipAt = { x, y };
    this.tooltipEl.replaceChildren();
    this.tooltipEl.append(el('strong', undefined, description.title));
    this.tooltipEl.append(el('span', undefined, description.value));
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top = `${y}px`;
    this.tooltipEl.classList.add('visible');
    this.keepTooltipOnScreen(x, y);
  }

  /**
   * Nudges the read-out back inside the window.
   *
   * The pointer sits on the control and the control can be anywhere, so near
   * an edge the label was simply cut off by the viewport — exactly when a
   * child is most likely to be hunting for it.
   *
   * It is measured at the origin rather than where it is about to land,
   * because a box hanging over the edge is squeezed narrow and tall by the
   * viewport: correcting by *that* width moves it somewhere it then re-wraps
   * to a different shape, and it is still off the screen. At the origin it
   * has room on every side and reports the size it will actually be. The
   * offset from the anchor comes out of the same measurement, so the
   * stylesheet stays free to change it.
   */
  private keepTooltipOnScreen(x: number, y: number): void {
    const pad = 8;
    const style = this.tooltipEl.style;
    style.left = '0px';
    style.top = '0px';
    const box = this.tooltipEl.getBoundingClientRect();
    const spanX = window.innerWidth - pad - box.width - box.left;
    const spanY = window.innerHeight - pad - box.height - box.top;
    style.left = `${Math.max(pad - box.left, Math.min(x, spanX))}px`;
    style.top = `${Math.max(pad - box.top, Math.min(y, spanY))}px`;
  }

  refreshTooltip(description: ControlDescription): void {
    if (!this.tooltipAt) return;
    this.showTooltip(description, this.tooltipAt.x, this.tooltipAt.y);
  }

  setSoundState(on: boolean): void {
    this.soundBtn.textContent = on ? '🔊' : '🔇';
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  /**
   * Puts the whole overlay out of reach while something sits in front of it.
   *
   * The welcome card covers the screen and takes the pointer, but on its own
   * that leaves the Tab key walking straight into the buttons behind — and
   * "Skriv ut listan" quietly producing a PDF from a screen nobody can see
   * is a strange first thing to have happen.
   */
  setInert(inert: boolean): void {
    this.root.toggleAttribute('inert', inert);
  }

  dispose(): void {
    this.root.remove();
    document.documentElement.lang = 'en';
  }

  setVrSupport(support: VrSupport): void {
    this.vrBtn.hidden = support !== 'available';
  }

  setVrPresenting(presenting: boolean): void {
    // The glyph does not change — you are wearing the thing — so the state
    // is carried by the name and by `aria-pressed`. The hint about the
    // wrist goes on the button that offers the headset, which is the last
    // thing read before the screen disappears.
    const name = presenting ? KID_UI.inVr : `${KID_UI.vr} — ${KID_UI.vrHint}`;
    this.vrBtn.setAttribute('aria-label', name);
    this.vrBtn.title = name;
    this.vrBtn.setAttribute('aria-pressed', String(presenting));
  }

  /**
   * The wrist board, in Swedish. In a headset this is the whole UI — the DOM
   * overlay does not exist there — so it carries the step, what to do, why,
   * and where the child is in the list.
   */
  vrCardContent(): VrCardContent {
    const pos = this.checklist.position;
    const done = Math.round(this.checklist.progress * this.totalItems);

    // Running, with nothing being asked for. The board's one button becomes
    // the way out, because in a headset there is no other button anywhere.
    if (this.checklist.holding) {
      return {
        glyph: '\u{1F389}',
        headline: KID_UI.runningTitle,
        detail: KID_UI.runningBody,
        button: KID_UI.shutdown,
        progress: this.checklist.progress,
        stepLabel: KID_UI.stepOf(done, this.totalItems),
        items: [],
        finished: false,
      };
    }

    if (!pos) {
      return {
        glyph: '\u{1F634}',
        headline: KID_UI.allDone,
        detail: '',
        button: '',
        progress: 1,
        stepLabel: `${this.totalItems} / ${this.totalItems}`,
        items: [],
        finished: true,
      };
    }

    const step = kidStep(pos.item.id) ?? UNKNOWN;
    return {
      // The picture carries the step; the words underneath are the caption.
      // No "why" here: in a headset it is one more paragraph between a
      // six-year-old and the switch, so it stays on the flat card where they
      // can open it when they want it.
      glyph: step.icon,
      headline: step.title,
      detail: step.action,
      // The board carries the only button in a headset, so what it offers
      // depends on what there is to offer: finding the control while a step
      // is being asked for, and starting the shutdown while none is.
      button: this.helpShown || !this.checklist.highlight ? '' : KID_UI.showMe,
      progress: this.checklist.progress,
      stepLabel: KID_UI.stepOf(done + 1, this.totalItems),
      items: windowChecklist(this.checklist, (item) => {
        const s = kidStep(item.id) ?? UNKNOWN;
        return { text: s.title, icon: s.icon };
      }),
      finished: false,
    };
  }

  /* No view bar, no quality picker and no yoke toggle in the kid UI, so
   * these have nothing to keep in step with. */
  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  private render(): void {
    const pos = this.checklist.position;
    // The arrow stays away until it is asked for. A six-year-old who is
    // shown the answer to every step learns where to look on the screen,
    // not where the switch is.
    this.callbacks.onGuideControl(this.helpShown ? this.checklist.highlight : null);

    const done = Math.round(this.checklist.progress * this.totalItems);
    const pct = this.totalItems === 0 ? 100 : (done / this.totalItems) * 100;
    this.fillEl.style.width = `${pct}%`;
    this.planeEl.style.left = `${pct}%`;

    this.whyEl.hidden = true;
    this.whyBtn.textContent = KID_UI.why;
    this.stuckEl.hidden = true;
    this.showBtn.classList.remove('nudge');
    this.shutdownBtn.hidden = !this.checklist.holding;

    // The aeroplane is running and nothing is being asked for. The card says
    // so and offers the way out; it does not ask for an answer.
    if (this.checklist.holding) {
      this.chipEl.textContent = '';
      this.stepNoEl.textContent = '';
      this.iconEl.textContent = '🎉';
      this.titleEl.textContent = KID_UI.runningTitle;
      this.actionEl.textContent = KID_UI.runningBody;
      this.showBtn.hidden = true;
      this.whyBtn.hidden = true;
      return;
    }

    if (!pos) {
      this.chipEl.textContent = '🏁';
      this.stepNoEl.textContent = '';
      this.iconEl.textContent = '😴';
      this.titleEl.textContent = KID_UI.allDone;
      this.actionEl.textContent = '';
      this.showBtn.hidden = true;
      this.whyBtn.hidden = true;
      return;
    }

    const step = kidStep(pos.item.id) ?? UNKNOWN;
    // Just what you are doing — "Gör dig klar". The step number was a count
    // of how much was left, on the one line that should say what is
    // happening now.
    this.chipEl.textContent = sectionName(pos.section.id);
    this.stepNoEl.textContent = String(this.numbers.get(pos.item.id) ?? '');
    this.iconEl.textContent = step.icon;
    this.titleEl.textContent = step.title;
    this.actionEl.textContent = step.action;
    this.whyEl.textContent = step.why;
    // In paper mode everything the sheet already says comes off the screen:
    // the instruction, the reason, and the two buttons that open them. What
    // is left is the number and the picture, which is what the child needs
    // to know they are on the right row.
    this.showBtn.hidden = this.paperMode || !this.checklist.highlight;
    this.whyBtn.hidden = this.paperMode;

    // Retrigger the entry animation so a new step is impossible to miss.
    this.cardEl.classList.remove('fresh');
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add('fresh');
  }

  /**
   * Points the arrow at the control. Nothing does this on its own: the whole
   * game is finding the switch, and an arrow that arms itself on every step
   * answers the question before it has been asked.
   */
  /**
   * The wrist board's one button. What it does is whatever it currently
   * says: there is no second button to put the other thing on.
   */
  onBoardButton(): void {
    if (this.checklist.holding) this.startShutdown();
    else this.requestHelp();
  }

  requestHelp(): void {
    const id = this.checklist.highlight;
    if (!id) return;
    this.helpShown = true;
    this.callbacks.onGuideControl(id);
    this.stuckEl.hidden = true;
    this.showBtn.classList.remove('nudge');
  }

  /**
   * The button. It arms the arrow and then takes them there, which is the
   * part that has to be asked for — turning somebody's head for them is
   * disorienting on a screen and worse in a headset, where the board calls
   * `requestHelp` on its own instead.
   */
  private showMe(): void {
    const id = this.checklist.highlight;
    this.requestHelp();
    if (id) this.callbacks.onShowControl(id);
  }

  /**
   * Begins the shutdown, which nothing else does. The list has been sitting
   * at the end of the start waiting to be asked.
   */
  private startShutdown(): void {
    if (!this.checklist.holding) return;
    this.checklist.release();
    this.itemAge = 0;
    this.helpShown = false;
    this.render();
  }

  private toggleWhy(): void {
    this.whyEl.hidden = !this.whyEl.hidden;
    this.whyBtn.textContent = this.whyEl.hidden ? KID_UI.why : KID_UI.hideWhy;
  }

  private onItemComplete(item: ChecklistItem): void {
    const step = kidStep(item.id) ?? UNKNOWN;
    const praise = KID_PRAISE[this.praiseIndex % KID_PRAISE.length] ?? 'Bra jobbat!';
    this.praiseIndex += 1;
    this.toast('done', '⭐', praise, step.title);
  }

  private onFault(fault: Fault): void {
    const kid = KID_FAULTS[fault.code];
    this.toast('oops', '💡', `Oj då! ${kid.title}`, kid.message);
  }

  /**
   * Confetti and a word, and nothing to dismiss.
   *
   * This was a modal over the cockpit asking whether they would like to shut
   * the aeroplane down now — which turns the reward for getting an engine
   * going into a fresh instruction to turn it off, and puts a dialogue
   * between a six-year-old and the aeroplane they have just started. The
   * shutdown is a button on the card instead, pressed when they feel like it.
   */
  private celebrate(): void {
    this.finishEl.replaceChildren();
    for (const piece of ['🎉', '✈️', '⭐', '🎊', '🛩️', '⭐', '🎉', '🎈']) {
      this.finishEl.append(el('span', undefined, piece));
    }
    this.finishEl.hidden = false;
    this.toast('done', '🎉', KID_UI.goalTitle, '');
    // Long enough to see, short enough not to become scenery.
    window.setTimeout(() => {
      this.finishEl.hidden = true;
      this.finishEl.replaceChildren();
    }, 6000);
  }

  private toast(kind: string, icon: string, title: string, body: string): void {
    const node = el('div', `kid-toast ${kind}`);
    node.append(el('span', 'kid-toast-icon', icon));
    const words = el('div');
    words.append(el('strong', undefined, title));
    if (body) words.append(el('span', undefined, body));
    node.append(words);
    this.toastsEl.prepend(node);
    while (this.toastsEl.childElementCount > 3) this.toastsEl.lastElementChild?.remove();
    setTimeout(
      () => {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), 400);
      },
      kind === 'done' ? 2400 : 9000,
    );
  }

  /**
   * A button in the top bar: the glyph, and the word only where it does not
   * take up room.
   *
   * These are the grown-up's controls, in the corner the child is not meant
   * to be reading, and three labelled pills up there compete with the one
   * thing on screen that matters. The Swedish stays on as the button's name,
   * so hovering it and reading it aloud both still say what it does.
   */
  private toolButton(icon: string, name: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'kid-tool', icon);
    btn.type = 'button';
    btn.setAttribute('aria-label', name);
    btn.title = name;
    btn.addEventListener('click', onClick);
    return btn;
  }
}
