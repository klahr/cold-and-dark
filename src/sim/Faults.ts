/**
 * Faults are how a mistake becomes a lesson. Every failure mode the engine
 * model can produce raises one of these, and the coaching layer turns it
 * into plain language instead of letting the engine just silently not start.
 */
export type FaultCode =
  | 'no-power'
  | 'mixture-cutoff'
  | 'fuel-off'
  | 'fuel-starvation'
  | 'mags-off'
  | 'not-primed'
  | 'flooded'
  | 'battery-low'
  | 'battery-flat'
  | 'starter-hot'
  | 'starter-while-running'
  | 'no-oil-pressure'
  | 'throttle-too-far'
  | 'low-voltage';

export type FaultSeverity = 'info' | 'caution' | 'warning';

export interface Fault {
  code: FaultCode;
  severity: FaultSeverity;
  title: string;
  /** What went wrong and what to do about it, in a sentence or two. */
  message: string;
  /** Simulation time when the fault was first raised. */
  since: number;
}

interface FaultSpec {
  severity: FaultSeverity;
  title: string;
  message: string;
}

const CATALOGUE: Record<FaultCode, FaultSpec> = {
  'no-power': {
    severity: 'caution',
    title: 'No electrical power',
    message:
      'The bus is dead, so the starter cannot turn. Switch the BAT half of the master on first.',
  },
  'mixture-cutoff': {
    severity: 'caution',
    title: 'Mixture at idle cutoff',
    message:
      'With the mixture pulled out no fuel reaches the cylinders, so the engine will crank forever without firing. Push the red knob fully in.',
  },
  'fuel-off': {
    severity: 'caution',
    title: 'Fuel selector OFF',
    message:
      'No fuel is reaching the carburettor. The engine may catch briefly on what is left in the float bowl and then quit. Select BOTH.',
  },
  'fuel-starvation': {
    severity: 'warning',
    title: 'Fuel starvation',
    message:
      'The carburettor bowl has run dry. This is what an unnoticed fuel selector in OFF feels like in flight.',
  },
  'mags-off': {
    severity: 'caution',
    title: 'No ignition',
    message:
      'The magnetos are not selected, so there is no spark. The key must be at BOTH before it will start.',
  },
  'not-primed': {
    severity: 'info',
    title: 'Not enough prime',
    message:
      'A cold carburetted engine cannot draw enough fuel at cranking speed. Give it two to six full primer strokes and try again.',
  },
  flooded: {
    severity: 'warning',
    title: 'Engine flooded',
    message:
      'Too much prime has soaked the cylinders. Clear it: mixture to IDLE CUTOFF, throttle FULL OPEN, crank, and advance the mixture as the engine fires.',
  },
  'battery-low': {
    severity: 'caution',
    title: 'Battery getting weak',
    message:
      'Repeated cranking has pulled the battery down and the starter is turning slowly. Let it rest before the next attempt.',
  },
  'battery-flat': {
    severity: 'warning',
    title: 'Battery flat',
    message:
      'There is no longer enough charge to turn the starter. In the real aeroplane this is where you go looking for a ground power unit.',
  },
  'starter-hot': {
    severity: 'warning',
    title: 'Starter overheated',
    message:
      'The starter has been cranked past its duty cycle. It has to cool before it will engage again.',
  },
  'starter-while-running': {
    severity: 'warning',
    title: 'Starter engaged while running',
    message:
      'The key was held past BOTH with the engine running, grinding the starter against the ring gear. Release the key as soon as it fires.',
  },
  'no-oil-pressure': {
    severity: 'warning',
    title: 'No oil pressure',
    message:
      'Oil pressure did not reach the green within 30 seconds of starting. Shut the engine down before it destroys itself.',
  },
  'throttle-too-far': {
    severity: 'caution',
    title: 'Throttle too far open',
    message:
      'The engine will catch at a dangerously high RPM with cold oil. Set the throttle about a quarter of an inch open for start.',
  },
  'low-voltage': {
    severity: 'caution',
    title: 'Low voltage',
    message:
      'The alternator is not carrying the load, so the battery is discharging. Check the ALT half of the master and the ALT FLD breaker.',
  },
};

export class FaultLog {
  private readonly current = new Map<FaultCode, Fault>();
  private readonly seen: Fault[] = [];
  private listeners = new Set<(fault: Fault) => void>();

  /** Raises a fault, or does nothing if it is already active. */
  raise(code: FaultCode, now: number): void {
    if (this.current.has(code)) return;
    const spec = CATALOGUE[code];
    const fault: Fault = { code, since: now, ...spec };
    this.current.set(code, fault);
    this.seen.push(fault);
    for (const listener of this.listeners) listener(fault);
  }

  clear(code: FaultCode): void {
    this.current.delete(code);
  }

  isActive(code: FaultCode): boolean {
    return this.current.has(code);
  }

  /** Every fault currently true of the aeroplane. */
  active(): Fault[] {
    return [...this.current.values()];
  }

  /** Everything raised since the last reset, including cleared faults. */
  history(): readonly Fault[] {
    return this.seen;
  }

  onRaise(listener: (fault: Fault) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.current.clear();
    this.seen.length = 0;
  }
}
