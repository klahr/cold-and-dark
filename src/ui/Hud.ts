import type { AircraftDefinition, ChecklistItem } from '../aircraft/types';
import { AIRCRAFT } from '../aircraft/registry';
import type { Simulation } from '../sim/Simulation';
import type { Fault } from '../sim/Faults';
import { ChecklistRunner } from '../sim/Checklist';
import {
  DIFFICULTIES,
  formatTime,
  type Challenge,
  type ChallengeResult,
} from '../sim/Challenge';
import { QUALITY_LEVELS, type QualityLevel } from '../render/postfx';
import { VIEW_PRESETS } from '../input/SeatedCamera';
import type { ControlDescription } from './describeControl';

export interface HudCallbacks {
  onSelectView(index: number): void;
  onReset(): void;
  onFocusControl(id: string): void;
  onGuideControl(id: string | null): void;
  onToggleSound(on: boolean): void;
  onToggleYokes(visible: boolean): void;
  onSelectAircraft(id: string): void;
  onSetQuality(level: QualityLevel): void;
  onEnterVr(): void;
}

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

function row(label: string, value: string): HTMLElement {
  const node = el('div', 'row');
  node.append(el('span', undefined, label));
  node.append(el('b', undefined, value));
  return node;
}

/**
 * The whole DOM overlay: checklist, coaching, timing, status and tooltip.
 *
 * There are two modes. **Practice** is the trainer: unlimited time, full
 * coaching, an explanation of every step. **Timed** is the game: the clock
 * runs from the moment you say go until the last checklist item is
 * satisfied. Difficulty changes only how much the trainer tells you — the
 * aeroplane behaves identically at every level, because the skill being
 * measured is knowing the procedure, not beating a handicap.
 */
export class Hud {
  readonly checklist: ChecklistRunner;

  private readonly root: HTMLElement;
  private readonly sim: Simulation;
  private readonly challenge: Challenge;
  private readonly aircraft: AircraftDefinition;
  private readonly callbacks: HudCallbacks;

  private readonly nodes: HTMLElement[] = [];
  private readonly tooltip: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly calloutEl: HTMLElement;
  private readonly whyEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly showMeBtn: HTMLButtonElement;
  private readonly progressEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly setupEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly viewButtons: HTMLButtonElement[] = [];
  private readonly soundBtn: HTMLButtonElement;
  private readonly yokeBtn: HTMLButtonElement;
  private readonly vrBtn: HTMLButtonElement;
  private readonly qualityPicker: HTMLSelectElement;
  private readonly inspectBadge: HTMLElement;
  private readonly modeBtns: HTMLButtonElement[] = [];
  private readonly difficultyBtns: HTMLButtonElement[] = [];

  private mode: 'practice' | 'challenge' = 'practice';
  private lastRenderedItemId: string | null = null;
  private tooltipAt: { x: number; y: number } | null = null;
  private statusTimer = 0;
  private hintShown = false;
  private itemAge = 0;
  private soundOn = false;
  private yokesVisible = true;

  constructor(
    root: HTMLElement,
    aircraft: AircraftDefinition,
    sim: Simulation,
    challenge: Challenge,
    callbacks: HudCallbacks,
  ) {
    this.root = root;
    this.sim = sim;
    this.challenge = challenge;
    this.aircraft = aircraft;
    this.callbacks = callbacks;
    this.checklist = new ChecklistRunner(aircraft.checklists, sim);

    /* --------------------------- title --------------------------- */
    const title = el('div', 'hud-title');
    title.append(el('strong', undefined, aircraft.name));
    title.append(el('span', undefined, aircraft.summary));
    this.add(title);

    /* ----------------------- option toggles ---------------------- */
    const options = el('div', 'options');
    if (AIRCRAFT.length > 1) {
      const picker = document.createElement('select');
      picker.className = 'aircraft-picker';
      picker.title = 'Load a different aircraft definition';
      for (const other of AIRCRAFT) {
        const option = document.createElement('option');
        option.value = other.id;
        option.textContent = other.name;
        option.selected = other.id === aircraft.id;
        picker.append(option);
      }
      picker.addEventListener('change', () => this.callbacks.onSelectAircraft(picker.value));
      options.append(picker);
    }

    this.qualityPicker = document.createElement('select');
    this.qualityPicker.className = 'aircraft-picker';
    this.qualityPicker.title =
      'Rendering quality. Resolution and ambient occlusion are the expensive parts.';
    for (const level of QUALITY_LEVELS) {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = level.label;
      this.qualityPicker.append(option);
    }
    this.qualityPicker.addEventListener('change', () =>
      this.callbacks.onSetQuality(this.qualityPicker.value as QualityLevel),
    );
    options.append(this.qualityPicker);

    this.soundBtn = this.button('Sound off', () => {
      this.soundOn = !this.soundOn;
      this.setSoundState(this.soundOn);
      this.callbacks.onToggleSound(this.soundOn);
    });
    this.yokeBtn = this.button('Hide yoke', () => {
      this.yokesVisible = !this.yokesVisible;
      this.setYokeState(this.yokesVisible);
      this.callbacks.onToggleYokes(this.yokesVisible);
    });
    this.yokeBtn.title =
      'The control wheel sits between you and the lower panel, just as it does in the aeroplane';
    this.vrBtn = this.button('Checking VR…', () => this.callbacks.onEnterVr());
    this.vrBtn.className = 'vr';
    this.vrBtn.disabled = true;
    options.append(this.soundBtn, this.yokeBtn, this.vrBtn);
    this.add(options);

    this.tooltip = el('div', 'tooltip');
    this.add(this.tooltip);

    this.toastsEl = el('div', 'toasts');
    this.add(this.toastsEl);

    this.timerEl = el('div', 'timer');
    this.timerEl.hidden = true;
    this.add(this.timerEl);

    // The inspect camera is a development tool, and while it is active the
    // view buttons appear to do nothing. Say so, on screen.
    this.inspectBadge = el(
      'div',
      'inspect-badge',
      'Inspect camera — press Esc, or pick a view, to sit back down',
    );
    this.inspectBadge.hidden = true;
    this.add(this.inspectBadge);

    /* ------------------------ checklist panel --------------------- */
    this.panel = el('aside', 'checklist');

    const head = el('header', 'checklist-head');
    const modes = el('div', 'modes');
    this.modeBtns = [
      this.modeButton(modes, 'Practice', 'practice'),
      this.modeButton(modes, 'Timed', 'challenge'),
    ];
    head.append(modes);
    this.panel.append(head);

    this.progressEl = el('div', 'progress');
    this.progressEl.append(el('i'));
    this.panel.append(this.progressEl);

    this.setupEl = el('div', 'setup');
    const diffRow = el('div', 'difficulties');
    for (const spec of DIFFICULTIES) {
      const btn = el('button', undefined, spec.label);
      btn.type = 'button';
      btn.title = spec.blurb;
      btn.addEventListener('click', () => {
        this.challenge.setDifficulty(spec.id);
        this.renderSetup();
      });
      diffRow.append(btn);
      this.difficultyBtns.push(btn);
    }
    this.setupEl.append(diffRow);
    this.setupEl.append(el('p', 'blurb'));
    this.setupEl.append(el('p', 'best'));
    const startBtn = el('button', 'start', 'Start the clock');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => this.beginRun());
    this.setupEl.append(startBtn);
    this.panel.append(this.setupEl);

    this.currentEl = el('div', 'current');
    this.calloutEl = el('div', 'callout');
    this.whyEl = el('p', 'why');
    this.hintEl = el('p', 'hint-line');
    const actions = el('div', 'actions');
    this.showMeBtn = el('button', undefined, 'Show me');
    this.showMeBtn.type = 'button';
    this.showMeBtn.addEventListener('click', () => this.showMe());
    const skipBtn = el('button', undefined, 'Skip');
    skipBtn.type = 'button';
    skipBtn.addEventListener('click', () => this.checklist.skip());
    actions.append(this.showMeBtn, skipBtn);
    this.currentEl.append(this.calloutEl, this.whyEl, this.hintEl, actions);
    this.panel.append(this.currentEl);

    this.listEl = el('ol', 'items');
    this.panel.append(this.listEl);

    const foot = el('footer', 'checklist-foot');
    const resetBtn = el('button', undefined, 'Reset to cold and dark');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => this.callbacks.onReset());
    foot.append(resetBtn);
    this.panel.append(foot);
    this.add(this.panel);

    this.resultEl = el('div', 'result');
    this.resultEl.hidden = true;
    this.add(this.resultEl);

    this.statusEl = el('div', 'status');
    this.add(this.statusEl);

    const bar = el('div', 'view-bar');
    VIEW_PRESETS.forEach((preset, i) => {
      const btn = el('button', undefined);
      btn.type = 'button';
      btn.innerHTML = `${preset.label}<kbd>${i + 1}</kbd>`;
      btn.setAttribute('aria-pressed', String(i === 0));
      btn.addEventListener('click', () => {
        this.callbacks.onSelectView(i);
        this.setActiveView(i);
      });
      bar.append(btn);
      this.viewButtons.push(btn);
    });
    this.add(bar);

    this.sim.faults.onRaise((fault) => this.onFault(fault));
    this.checklist.onAdvance((item) => this.onItemComplete(item));

    this.applyMode();
  }

  /* ------------------------------------------------------------------ */
  /* Public surface                                                      */
  /* ------------------------------------------------------------------ */

  setActiveView(index: number): void {
    this.viewButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
  }

  setVrSupport(support: 'unsupported' | 'available'): void {
    const available = support === 'available';
    this.vrBtn.disabled = !available;
    this.vrBtn.textContent = available ? 'Enter VR' : 'VR unavailable';
    this.vrBtn.title = available
      ? 'Fly the cockpit in a headset. Trigger to operate a control.'
      : 'No WebXR headset was detected in this browser.';
  }

  setVrPresenting(presenting: boolean): void {
    if (this.vrBtn.disabled) return;
    this.vrBtn.textContent = presenting ? 'In VR' : 'Enter VR';
    this.vrBtn.setAttribute('aria-pressed', String(presenting));
  }

  setInspecting(on: boolean): void {
    this.inspectBadge.hidden = !on;
  }

  setQuality(level: QualityLevel): void {
    this.qualityPicker.value = level;
  }

  setSoundState(on: boolean): void {
    this.soundOn = on;
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  setYokeState(visible: boolean): void {
    this.yokesVisible = visible;
    this.yokeBtn.textContent = visible ? 'Hide yoke' : 'Show yoke';
    this.yokeBtn.setAttribute('aria-pressed', String(!visible));
  }

  dispose(): void {
    for (const node of this.nodes) node.remove();
    this.nodes.length = 0;
  }

  reset(): void {
    this.checklist.restart();
    this.lastRenderedItemId = null;
    this.toastsEl.replaceChildren();
    this.renderCurrent();
    this.renderList();
  }

  onActuate(id: string): void {
    this.hintShown = false;

    // Operating the right control at the wrong point in the list is
    // indistinguishable from the control not working, so say so. Hard mode
    // stays quiet: working out the order is the whole exercise.
    if (!this.coaching.showList) return;
    const pos = this.checklist.position;
    const pending = this.checklist.pendingItemFor(id);
    if (!pos || !pending) return;
    this.toast(
      'info',
      'Not this one yet',
      `${pending.callout} comes later. Next up is ${pos.item.callout}.`,
    );
  }

  refreshTooltip(description: ControlDescription): void {
    if (!this.tooltipAt) return;
    this.showTooltip(description, this.tooltipAt.x, this.tooltipAt.y);
  }

  showTooltip(description: ControlDescription | null, x: number, y: number): void {
    if (!description) {
      this.tooltipAt = null;
      this.tooltip.classList.remove('visible');
      return;
    }
    this.tooltipAt = { x, y };
    this.tooltip.replaceChildren();
    this.tooltip.append(el('div', 'name', description.title));
    this.tooltip.append(el('span', 'value', description.value));
    // Withheld in a timed run, or the tooltip would hand over the whole
    // procedure one hover at a time.
    if (description.detail && this.coaching.showCoaching) {
      this.tooltip.append(el('div', 'detail', description.detail));
    }
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.classList.add('visible');
  }

  update(dt: number): void {
    this.checklist.update(dt);

    if (this.challenge.running) {
      this.challenge.tick(dt);
      this.timerEl.textContent = formatTime(this.challenge.totalSeconds);
      this.timerEl.classList.toggle('penalised', this.challenge.mistakeCount > 0);
      if (this.checklist.goalReached) this.completeRun();
    }

    const pos = this.checklist.position;
    if (pos?.item.id !== this.lastRenderedItemId) {
      this.itemAge = 0;
      this.hintShown = false;
      this.renderCurrent();
      this.renderList();
    }
    this.itemAge += dt;

    if (
      !this.hintShown &&
      this.itemAge > 12 &&
      pos &&
      this.coaching.showCoaching
    ) {
      this.hintShown = true;
      this.hintEl.classList.add('visible');
    }

    this.statusTimer += dt;
    if (this.statusTimer > 0.1) {
      this.statusTimer = 0;
      this.renderStatus();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mode and challenge                                                  */
  /* ------------------------------------------------------------------ */

  /** What the pilot is allowed to see, given the mode and difficulty. */
  private get coaching(): { showList: boolean; showCoaching: boolean; highlight: boolean } {
    if (this.mode === 'practice') {
      return { showList: true, showCoaching: true, highlight: true };
    }
    if (this.challenge.state !== 'running') {
      // Before the clock starts and after it stops, give nothing away.
      return { showList: false, showCoaching: false, highlight: false };
    }
    const spec = this.challenge.spec;
    return {
      showList: spec.showList,
      showCoaching: spec.showCoaching,
      highlight: spec.highlightControl,
    };
  }

  private setMode(mode: 'practice' | 'challenge'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.challenge.abort();
    this.resultEl.hidden = true;
    this.callbacks.onReset();
    this.applyMode();
  }

  private applyMode(): void {
    this.modeBtns.forEach((b, i) =>
      b.setAttribute('aria-pressed', String((i === 1) === (this.mode === 'challenge'))),
    );
    const timed = this.mode === 'challenge';
    this.setupEl.hidden = !timed || this.challenge.state !== 'idle';
    this.timerEl.hidden = !this.challenge.running;
    this.progressEl.hidden = !this.coaching.showList;
    this.renderSetup();
    this.renderCurrent();
    this.renderList();
  }

  private beginRun(): void {
    this.callbacks.onReset();
    this.challenge.start();
    this.resultEl.hidden = true;
    this.setupEl.hidden = true;
    this.timerEl.hidden = false;
    this.timerEl.textContent = formatTime(0);
    this.applyMode();
  }

  private completeRun(): void {
    const result = this.challenge.finish(this.aircraft.id);
    this.timerEl.hidden = true;
    this.renderResult(result);
    this.applyMode();
  }

  private renderSetup(): void {
    const spec = this.challenge.spec;
    this.difficultyBtns.forEach((btn, i) =>
      btn.setAttribute('aria-pressed', String(DIFFICULTIES[i]?.id === spec.id)),
    );
    const blurb = this.setupEl.querySelector('.blurb');
    if (blurb) blurb.textContent = spec.blurb;
    const best = this.challenge.bestFor(this.aircraft.id, spec.id);
    const bestEl = this.setupEl.querySelector('.best');
    if (bestEl) {
      bestEl.textContent = best === null ? 'No time set yet.' : `Your best: ${formatTime(best)}`;
    }
  }

  private renderResult(result: ChallengeResult): void {
    this.resultEl.hidden = false;
    this.resultEl.replaceChildren();

    this.resultEl.append(
      el('div', 'result-kicker', result.isPersonalBest ? 'New personal best' : 'Engine running'),
    );
    this.resultEl.append(el('div', 'result-time', formatTime(result.totalSeconds)));

    const detail = el('div', 'result-detail');
    detail.append(row('On the clock', formatTime(result.rawSeconds)));
    detail.append(
      row(
        'Mistakes',
        result.mistakes.length === 0
          ? 'none'
          : `${result.mistakes.length}  (+${result.penaltySeconds}s)`,
      ),
    );
    detail.append(
      row(
        'Difficulty',
        DIFFICULTIES.find((d) => d.id === result.difficulty)?.label ?? result.difficulty,
      ),
    );
    if (result.previousBest !== null) {
      detail.append(row('Previous best', formatTime(result.previousBest)));
    }
    this.resultEl.append(detail);

    if (result.mistakes.length > 0) {
      const list = el('ul', 'result-mistakes');
      for (const m of result.mistakes) list.append(el('li', undefined, m.title));
      this.resultEl.append(list);
    }

    const again = el('button', 'start', 'Run it again');
    again.type = 'button';
    again.addEventListener('click', () => {
      this.challenge.abort();
      this.resultEl.hidden = true;
      this.callbacks.onReset();
      this.applyMode();
    });
    this.resultEl.append(again);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  private showMe(): void {
    const highlight = this.checklist.position?.item.highlight;
    if (highlight) this.callbacks.onFocusControl(highlight);
    this.hintShown = true;
    this.hintEl.classList.add('visible');
  }

  private onItemComplete(item: ChecklistItem): void {
    if (this.coaching.showList) this.toast('done', 'Checked', item.callout);
  }

  private onFault(fault: Fault): void {
    this.challenge.recordFault(fault);
    if (this.coaching.showCoaching || this.mode === 'practice') {
      this.toast(fault.severity, fault.title, fault.message);
    } else {
      // A timed run gets the headline and the cost, not the answer.
      this.toast(
        fault.severity,
        fault.title,
        this.challenge.running ? `+${this.challenge.spec.penaltyPerFault}s penalty` : '',
      );
    }
  }

  private renderCurrent(): void {
    const pos = this.checklist.position;
    this.lastRenderedItemId = pos?.item.id ?? null;
    const coaching = this.coaching;

    this.currentEl.hidden = !coaching.showList;
    this.listEl.hidden = !coaching.showList;
    this.progressEl.hidden = !coaching.showList;
    this.panel.classList.toggle('blind', !coaching.showList);

    this.callbacks.onGuideControl(coaching.highlight ? (pos?.item.highlight ?? null) : null);
    if (!coaching.showList) return;

    if (!pos) {
      this.calloutEl.textContent = 'Checklist complete';
      this.whyEl.textContent =
        'The engine is running, the alternator is charging and the aeroplane is ready to taxi.';
      this.whyEl.hidden = false;
      this.hintEl.textContent = '';
      this.showMeBtn.hidden = true;
      return;
    }

    this.calloutEl.textContent = pos.item.callout;
    this.whyEl.textContent = pos.item.why;
    this.whyEl.hidden = !coaching.showCoaching;
    this.hintEl.textContent = pos.item.hint;
    this.hintEl.classList.remove('visible');
    this.showMeBtn.hidden = !pos.item.highlight || !coaching.showCoaching;
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (!this.coaching.showList) return;

    const pos = this.checklist.position;
    for (const [si, section] of this.checklist.allSections.entries()) {
      const header = el('li', 'section', section.title);
      // Jumping about would make a timed run meaningless.
      if (!this.challenge.running) {
        header.classList.add('clickable');
        header.addEventListener('click', () => {
          this.checklist.jumpToSection(si);
          this.renderCurrent();
          this.renderList();
        });
      }
      this.listEl.append(header);

      for (const item of section.items) {
        const li = el('li', 'item');
        const done = this.checklist.isDone(item.id);
        const isCurrent = pos?.item.id === item.id;
        if (done) li.classList.add('done');
        if (isCurrent) li.classList.add('current');
        li.append(el('span', 'tick', done ? '✓' : isCurrent ? '▸' : ''));
        li.append(el('span', 'text', item.callout));
        this.listEl.append(li);
      }
    }

    const bar = this.progressEl.querySelector('i');
    if (bar) {
      // A timed run is measured against getting it started, not against
      // the shutdown drill that follows.
      const fraction =
        this.mode === 'challenge' ? this.checklist.goalProgress : this.checklist.progress;
      bar.style.width = `${Math.round(fraction * 100)}%`;
    }
  }

  private toast(kind: string, title: string, body: string): void {
    const node = el('div', `toast ${kind}`);
    node.append(el('strong', undefined, title));
    if (body) node.append(el('span', undefined, body));
    this.toastsEl.prepend(node);
    while (this.toastsEl.childElementCount > 4) this.toastsEl.lastElementChild?.remove();
    const life = kind === 'done' ? 2200 : 8000;
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 400);
    }, life);
  }

  private renderStatus(): void {
    const { engine, electrical, fuel, vacuum, ignition } = this.sim;
    const rows: [string, string][] = [
      ['Engine', engine.state.toUpperCase()],
      ['RPM', engine.rpm.toFixed(0)],
      ['Oil press', `${engine.oilPressure.toFixed(0)} psi`],
      ['Bus', `${electrical.busVolts.toFixed(1)} V`],
      ['Ammeter', `${electrical.ammeter >= 0 ? '+' : ''}${electrical.ammeter.toFixed(0)} A`],
      ['Battery', `${(electrical.charge * 100).toFixed(0)} %`],
      ['Suction', `${vacuum.suction.toFixed(1)} inHg`],
      ['Prime', `${fuel.primerStrokes} strokes`],
      ['Starter', ignition.lockedOut ? 'COOLING' : ignition.starterEngaged ? 'CRANKING' : '—'],
      ['Fuel L/R', `${fuel.leftLitres.toFixed(0)} / ${fuel.rightLitres.toFixed(0)} L`],
    ];

    this.statusEl.replaceChildren();
    this.statusEl.append(el('div', 'status-title', 'Systems'));
    for (const [k, v] of rows) this.statusEl.append(row(k, v));
  }

  /* ------------------------------------------------------------------ */

  private add(node: HTMLElement): void {
    this.root.append(node);
    this.nodes.push(node);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', undefined, label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  private modeButton(
    parent: HTMLElement,
    label: string,
    mode: 'practice' | 'challenge',
  ): HTMLButtonElement {
    const btn = el('button', undefined, label);
    btn.type = 'button';
    btn.addEventListener('click', () => this.setMode(mode));
    parent.append(btn);
    return btn;
  }
}
