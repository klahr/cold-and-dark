import type { AircraftDefinition, ChecklistItem } from '../../aircraft/types';
import type { Simulation } from '../../sim/Simulation';
import type { Fault } from '../../sim/Faults';
import { ChecklistRunner } from '../../sim/Checklist';
import type { QualityLevel } from '../../render/postfx';
import type { ControlDescription } from '../describeControl';
import type { HudCallbacks, TrainerHud } from '../TrainerHud';
import { windowChecklist, type VrCardContent } from '../VrChecklistCard';
import type { VrSupport } from '../../input/VrSession';
import { KID_FAULTS, KID_PRAISE, KID_UI, kidStep, type KidStep } from './swedish';

/** Seconds on one step before the UI offers to point at the control. */
const STUCK_AFTER = 15;

/** Fallback copy, so an untranslated item is still actionable rather than blank. */
const UNKNOWN: KidStep = {
  icon: '✈️',
  title: 'Nästa steg',
  action: 'Titta på den sak som lyser i cockpiten och klicka på den.',
  why: 'Varje steg gör planet lite mer redo att flyga.',
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The Swedish overlay for a child who can read.
 *
 * It runs the *same* checklist as the expert HUD, every item of it, against
 * the same simulation — the aeroplane is not made easier. What changes is
 * everything around the aeroplane: one step on screen at a time, in words a
 * six-year-old can act on, with the control lit up and the camera already
 * pointed at it, and a mistake answered with what to do next rather than
 * what went wrong.
 *
 * Two deliberate omissions. There is no timed mode, because a clock turns a
 * first attempt into a test. And there is no systems read-out, because a
 * child who cannot yet read "suction 4.8 inHg" only learns that part of the
 * screen is not for them.
 */
export class KidHud implements TrainerHud {
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
  private readonly cardEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly planeEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  private readonly finishEl: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly vrBtn: HTMLButtonElement;

  private readonly totalItems: number;
  private lastItemId: string | null = null;
  private itemAge = 0;
  private praiseIndex = 0;
  private celebrated = false;
  private tooltipAt: { x: number; y: number } | null = null;

  constructor(
    root: HTMLElement,
    aircraft: AircraftDefinition,
    sim: Simulation,
    callbacks: HudCallbacks,
  ) {
    this.sim = sim;
    this.callbacks = callbacks;
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
    this.soundBtn = this.toolButton(`🔊 ${KID_UI.sound}`, () =>
      this.callbacks.onToggleSound(this.soundBtn.getAttribute('aria-pressed') !== 'true'),
    );
    tools.append(this.soundBtn);
    tools.append(this.toolButton(KID_UI.reset, () => this.callbacks.onReset()));
    // Hidden until a headset is actually there. A disabled button explaining
    // a certificate problem is noise to a six-year-old; the grown-up can read
    // the real reason on the expert HUD.
    this.vrBtn = this.toolButton(`🥽 ${KID_UI.vr}`, () => this.callbacks.onEnterVr());
    this.vrBtn.hidden = true;
    tools.append(this.vrBtn);
    const adults = this.toolButton(KID_UI.adults, () => this.callbacks.onSelectUiMode('expert'));
    adults.classList.add('kid-quiet');
    tools.append(adults);
    bar.append(tools);
    this.root.append(bar);

    /* ---------------------------- progress ---------------------------- */
    const track = el('div', 'kid-track');
    this.fillEl = el('i');
    this.planeEl = el('span', 'kid-plane', '✈️');
    this.countEl = el('b', 'kid-count');
    track.append(this.fillEl, this.planeEl, this.countEl);
    this.root.append(track);

    /* ------------------------------ card ------------------------------ */
    this.cardEl = el('section', 'kid-card');
    this.chipEl = el('div', 'kid-chip');
    const head = el('div', 'kid-head');
    this.iconEl = el('div', 'kid-icon');
    this.titleEl = el('h2', 'kid-what');
    head.append(this.iconEl, this.titleEl);
    this.actionEl = el('p', 'kid-action');

    const acts = el('div', 'kid-acts');
    this.showBtn = el('button', 'kid-show', KID_UI.showMe);
    this.showBtn.type = 'button';
    this.showBtn.addEventListener('click', () => this.showMe());
    this.whyBtn = el('button', 'kid-why-btn', KID_UI.why);
    this.whyBtn.type = 'button';
    this.whyBtn.addEventListener('click', () => this.toggleWhy());
    acts.append(this.showBtn, this.whyBtn);

    this.whyEl = el('p', 'kid-why');
    this.whyEl.hidden = true;
    this.stuckEl = el('p', 'kid-stuck', KID_UI.stuck);
    this.stuckEl.hidden = true;

    this.cardEl.append(this.chipEl, head, this.actionEl, acts, this.whyEl, this.stuckEl);
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
      this.render();
      // Finding the control is handled by the arrow in the scene, which
      // flies to it and waits. Moving the camera on their behalf is saved
      // for "Var är den?" below, where they actually asked for it.
    }

    this.itemAge += dt;
    const stuck = pos !== null && this.itemAge > STUCK_AFTER;
    if (stuck === this.stuckEl.hidden) {
      this.stuckEl.hidden = !stuck;
      this.showBtn.classList.toggle('nudge', stuck);
    }

    if (!this.celebrated && this.checklist.goalReached) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  reset(): void {
    this.checklist.restart();
    this.lastItemId = null;
    this.itemAge = 0;
    this.celebrated = false;
    this.finishEl.hidden = true;
    this.toastsEl.replaceChildren();
    this.render();
  }

  onActuate(id: string): void {
    const pos = this.checklist.position;
    const pending = this.checklist.pendingItemFor(id);
    if (!pos || !pending) return;
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
  }

  refreshTooltip(description: ControlDescription): void {
    if (!this.tooltipAt) return;
    this.showTooltip(description, this.tooltipAt.x, this.tooltipAt.y);
  }

  setSoundState(on: boolean): void {
    this.soundBtn.textContent = `${on ? '🔊' : '🔇'} ${KID_UI.sound}`;
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  dispose(): void {
    this.root.remove();
    document.documentElement.lang = 'en';
  }

  setVrSupport(support: VrSupport): void {
    this.vrBtn.hidden = support !== 'available';
    this.vrBtn.title = KID_UI.vrHint;
  }

  setVrPresenting(presenting: boolean): void {
    this.vrBtn.textContent = presenting ? `🥽 ${KID_UI.inVr}` : `🥽 ${KID_UI.vr}`;
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

    if (!pos) {
      return {
        theme: 'kid',
        glyph: '\u{1F634}',
        title: KID_UI.title,
        section: '',
        headline: KID_UI.allDone,
        detail: '',
        hint: '',
        progress: 1,
        stepLabel: `${this.totalItems} / ${this.totalItems}`,
        items: [],
        finished: true,
      };
    }

    const step = kidStep(pos.item.id) ?? UNKNOWN;
    return {
      theme: 'kid',
      // The picture carries the step; the words underneath are the caption.
      glyph: step.icon,
      title: KID_UI.title,
      section: sectionName(pos.section.id),
      headline: step.title,
      detail: step.action,
      // No "why" on the board. In a headset it is one more paragraph between
      // a six-year-old and the switch; it stays on the flat card, where they
      // can open it when they want it.
      hint: '',
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
  setActiveView(): void {}
  setInspecting(): void {}
  setQuality(_level: QualityLevel): void {}
  setYokeState(): void {}

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  private render(): void {
    const pos = this.checklist.position;
    this.callbacks.onGuideControl(pos?.item.highlight ?? null);

    const done = Math.round(this.checklist.progress * this.totalItems);
    this.countEl.textContent = `${done} / ${this.totalItems}`;
    const pct = this.totalItems === 0 ? 100 : (done / this.totalItems) * 100;
    this.fillEl.style.width = `${pct}%`;
    this.planeEl.style.left = `${pct}%`;

    this.whyEl.hidden = true;
    this.whyBtn.textContent = KID_UI.why;
    this.stuckEl.hidden = true;
    this.showBtn.classList.remove('nudge');

    if (!pos) {
      this.chipEl.textContent = '🏁';
      this.iconEl.textContent = '😴';
      this.titleEl.textContent = KID_UI.allDone;
      this.actionEl.textContent = '';
      this.showBtn.hidden = true;
      this.whyBtn.hidden = true;
      return;
    }

    const step = kidStep(pos.item.id) ?? UNKNOWN;
    this.chipEl.textContent = `${KID_UI.stepOf(done + 1, this.totalItems)} · ${sectionName(
      pos.section.id,
    )}`;
    this.iconEl.textContent = step.icon;
    this.titleEl.textContent = step.title;
    this.actionEl.textContent = step.action;
    this.whyEl.textContent = step.why;
    this.showBtn.hidden = !pos.item.highlight;
    this.whyBtn.hidden = false;

    // Retrigger the entry animation so a new step is impossible to miss.
    this.cardEl.classList.remove('fresh');
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add('fresh');
  }

  /**
   * The impatient route. The arrow is already pointing, so this is for a
   * child who would rather be taken there than turn and look — an explicit
   * press, never something that happens to them.
   */
  private showMe(): void {
    const id = this.checklist.position?.item.highlight;
    if (id) this.callbacks.onShowControl(id);
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

  private celebrate(): void {
    this.finishEl.hidden = false;
    this.finishEl.replaceChildren();

    const confetti = el('div', 'kid-confetti');
    for (const piece of ['🎉', '✈️', '⭐', '🎊', '🛩️', '⭐', '🎉', '🎈']) {
      confetti.append(el('span', undefined, piece));
    }
    this.finishEl.append(confetti);

    const card = el('div', 'kid-finish-card');
    card.append(el('div', 'kid-finish-kicker', KID_UI.goalKicker));
    card.append(el('h2', undefined, KID_UI.goalTitle));
    card.append(el('p', undefined, KID_UI.goalBody));

    const actions = el('div', 'kid-finish-acts');
    const on = el('button', 'kid-go', KID_UI.goalContinue);
    on.type = 'button';
    on.addEventListener('click', () => {
      this.finishEl.hidden = true;
    });
    const again = el('button', 'kid-again', KID_UI.goalAgain);
    again.type = 'button';
    again.addEventListener('click', () => this.callbacks.onReset());
    actions.append(on, again);
    card.append(actions);
    this.finishEl.append(card);
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

  private toolButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'kid-tool', label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }
}

/** Section headings, in the same plain Swedish as the steps. */
function sectionName(sectionId: string): string {
  if (sectionId === 'before-start') return KID_UI.sectionBefore;
  if (sectionId === 'shutdown') return KID_UI.sectionSecure;
  return KID_UI.sectionStart;
}
