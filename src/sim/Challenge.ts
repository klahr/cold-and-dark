import type { Fault, FaultCode } from './Faults';

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * How much the trainer tells you. This is the only thing difficulty
 * changes: the aeroplane behaves identically at every level, because the
 * skill being timed is knowing the procedure, not beating a handicap.
 */
export interface DifficultySpec {
  id: Difficulty;
  label: string;
  blurb: string;
  /** Show the full list of items and where you are in it. */
  showList: boolean;
  /** Show the current callout, its reasoning and the "show me" button. */
  showCoaching: boolean;
  /** Pulse the control in the 3D cockpit. */
  highlightControl: boolean;
  /** Seconds added for each distinct mistake. */
  penaltyPerFault: number;
}

export const DIFFICULTIES: readonly DifficultySpec[] = [
  {
    id: 'easy',
    label: 'Easy',
    blurb: 'Full coaching: the next item, why it matters, and the control lit up in the cockpit.',
    showList: true,
    showCoaching: true,
    highlightControl: true,
    penaltyPerFault: 5,
  },
  {
    id: 'normal',
    label: 'Normal',
    blurb: 'The checklist and your progress through it, but no reasoning and nothing highlighted.',
    showList: true,
    showCoaching: false,
    highlightControl: false,
    penaltyPerFault: 10,
  },
  {
    id: 'hard',
    label: 'Hard',
    blurb: 'No checklist at all. Start the aeroplane from memory.',
    showList: false,
    showCoaching: false,
    highlightControl: false,
    penaltyPerFault: 15,
  },
];

export function difficultySpec(id: Difficulty): DifficultySpec {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0]!;
}

export type ChallengeState = 'idle' | 'running' | 'finished';

export interface ChallengeResult {
  aircraftId: string;
  difficulty: Difficulty;
  /** Wall-clock seconds from start to the last checklist item. */
  rawSeconds: number;
  penaltySeconds: number;
  totalSeconds: number;
  mistakes: { code: FaultCode; title: string }[];
  /** Best total for this aircraft and difficulty before this run, if any. */
  previousBest: number | null;
  isPersonalBest: boolean;
}

const STORAGE_KEY = 'flightsim.bestTimes.v1';

/**
 * The timed start challenge.
 *
 * The clock starts when the pilot says go and stops the moment the last
 * checklist item is satisfied. Mistakes cost time rather than ending the
 * run, which keeps a botched start instructive instead of punishing.
 */
export class Challenge {
  state: ChallengeState = 'idle';
  difficulty: Difficulty = 'easy';
  elapsed = 0;

  private readonly counted = new Set<FaultCode>();
  private mistakes: { code: FaultCode; title: string }[] = [];
  private result: ChallengeResult | null = null;

  get spec(): DifficultySpec {
    return difficultySpec(this.difficulty);
  }

  get running(): boolean {
    return this.state === 'running';
  }

  get penaltySeconds(): number {
    return this.counted.size * this.spec.penaltyPerFault;
  }

  get totalSeconds(): number {
    return this.elapsed + this.penaltySeconds;
  }

  get lastResult(): ChallengeResult | null {
    return this.result;
  }

  /** Mistakes made so far this run, for the live read-out. */
  get mistakeCount(): number {
    return this.counted.size;
  }

  setDifficulty(difficulty: Difficulty): void {
    if (this.state === 'running') return;
    this.difficulty = difficulty;
  }

  start(): void {
    this.state = 'running';
    this.elapsed = 0;
    this.counted.clear();
    this.mistakes = [];
    this.result = null;
  }

  abort(): void {
    this.state = 'idle';
    this.elapsed = 0;
    this.counted.clear();
    this.mistakes = [];
  }

  tick(dt: number): void {
    if (this.state === 'running') this.elapsed += dt;
  }

  /** Records a fault as a time penalty. Each kind only counts once. */
  recordFault(fault: Fault): void {
    if (this.state !== 'running' || this.counted.has(fault.code)) return;
    this.counted.add(fault.code);
    this.mistakes.push({ code: fault.code, title: fault.title });
  }

  /** Stops the clock and banks the result. */
  finish(aircraftId: string): ChallengeResult {
    this.state = 'finished';
    const total = this.totalSeconds;
    const previousBest = readBest(aircraftId, this.difficulty);
    const isPersonalBest = previousBest === null || total < previousBest;
    if (isPersonalBest) writeBest(aircraftId, this.difficulty, total);

    this.result = {
      aircraftId,
      difficulty: this.difficulty,
      rawSeconds: this.elapsed,
      penaltySeconds: this.penaltySeconds,
      totalSeconds: total,
      mistakes: [...this.mistakes],
      previousBest,
      isPersonalBest,
    };
    return this.result;
  }

  bestFor(aircraftId: string, difficulty: Difficulty): number | null {
    return readBest(aircraftId, difficulty);
  }
}

/* ------------------------------------------------------------------ */
/* Personal bests                                                      */
/* ------------------------------------------------------------------ */

type BestTimes = Record<string, number>;

function loadAll(): BestTimes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BestTimes) : {};
  } catch {
    // Private browsing, disabled storage, or corrupt JSON: bests are a
    // nicety, so silently carry on without them.
    return {};
  }
}

function readBest(aircraftId: string, difficulty: Difficulty): number | null {
  const all = loadAll();
  const value = all[`${aircraftId}:${difficulty}`];
  return typeof value === 'number' ? value : null;
}

function writeBest(aircraftId: string, difficulty: Difficulty, seconds: number): void {
  try {
    const all = loadAll();
    all[`${aircraftId}:${difficulty}`] = seconds;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Storage unavailable; the run still counts for this session. */
  }
}

/** mm:ss.t, the way a stopwatch reads. */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
