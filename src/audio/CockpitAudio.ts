import type { Simulation } from '../sim/Simulation';

/**
 * Procedural cockpit sound. Everything is synthesised at runtime — no audio
 * files — so the engine note tracks RPM exactly rather than crossfading
 * between samples, and the whole thing ships with the code.
 *
 * Browsers will not start an AudioContext without a gesture, so nothing is
 * built until the pilot first touches something.
 */
/**
 * Gyro whine, the one voice in the mix that is a steady tone rather than a
 * noise or a rumble.
 *
 * The gain looks tiny next to the engine's 0.2, and it is — but it sits in
 * the 1.5–4 kHz band the ear is most sensitive to, so by loudness rather
 * than amplitude it was the most prominent thing in a quiet cockpit. It is
 * meant to be the sound of something spinning up somewhere behind the panel,
 * noticed only if you listen for it.
 */
const GYRO_PEAK_GAIN = 0.0038;
const GYRO_BASE_HZ = 1180;
const GYRO_SPOOL_HZ = 620;

export class CockpitAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private starterGain: GainNode | null = null;
  private starterOsc: OscillatorNode | null = null;

  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineHarm: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private exhaustGain: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;

  private gyroGain: GainNode | null = null;
  private gyroOsc: OscillatorNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  /** Starts silent: nobody wants a browser tab to make noise unprompted. */
  private muted = true;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Called from the first user gesture. Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) this.build();
    void this.ctx?.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    this.noiseBuffer = makeNoise(ctx);

    /* --------------------------- starter --------------------------- */
    // A geared starter motor: a low whine plus the rattle of the ring gear.
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    this.starterGain.connect(this.master);

    this.starterOsc = ctx.createOscillator();
    this.starterOsc.type = 'sawtooth';
    this.starterOsc.frequency.value = 95;
    const starterFilter = ctx.createBiquadFilter();
    starterFilter.type = 'lowpass';
    starterFilter.frequency.value = 900;
    this.starterOsc.connect(starterFilter).connect(this.starterGain);
    this.starterOsc.start();

    const starterNoise = ctx.createBufferSource();
    starterNoise.buffer = this.noiseBuffer;
    starterNoise.loop = true;
    const starterBand = ctx.createBiquadFilter();
    starterBand.type = 'bandpass';
    starterBand.frequency.value = 480;
    starterBand.Q.value = 1.2;
    const starterNoiseGain = ctx.createGain();
    starterNoiseGain.gain.value = 0.5;
    starterNoise.connect(starterBand).connect(starterNoiseGain).connect(this.starterGain);
    starterNoise.start();

    /* -------------------------- combustion ------------------------- */
    // A four-cylinder four-stroke fires twice per revolution, so the
    // fundamental is RPM/30 Hz: about 33 Hz at a 1000 RPM idle.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.Q.value = 0.8;
    this.engineFilter.connect(this.engineGain);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 33;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineHarm = ctx.createOscillator();
    this.engineHarm.type = 'square';
    this.engineHarm.frequency.value = 66;
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.22;
    this.engineHarm.connect(harmGain).connect(this.engineFilter);
    this.engineHarm.start();

    /* ------------------------ exhaust / slipstream ----------------- */
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.exhaustGain.connect(this.master);

    const exhaustNoise = ctx.createBufferSource();
    exhaustNoise.buffer = this.noiseBuffer;
    exhaustNoise.loop = true;
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = 'lowpass';
    this.exhaustFilter.frequency.value = 400;
    exhaustNoise.connect(this.exhaustFilter).connect(this.exhaustGain);
    exhaustNoise.start();

    /* ---------------------------- gyros ---------------------------- */
    this.gyroGain = ctx.createGain();
    this.gyroGain.gain.value = 0;
    this.gyroGain.connect(this.master);

    // A triangle at 2 kHz has its harmonics at 6 and 10 kHz, which is what
    // makes the whine read as a piercing electronic beep rather than as
    // something spinning. Rolling them off leaves the tone without the edge.
    const gyroFilter = ctx.createBiquadFilter();
    gyroFilter.type = 'lowpass';
    gyroFilter.frequency.value = 2600;
    gyroFilter.Q.value = 0.7;
    gyroFilter.connect(this.gyroGain);

    this.gyroOsc = ctx.createOscillator();
    this.gyroOsc.type = 'triangle';
    this.gyroOsc.frequency.value = GYRO_BASE_HZ;
    this.gyroOsc.connect(gyroFilter);
    this.gyroOsc.start();
  }

  /** A short mechanical click when a switch or knob is moved. */
  click(kind: 'switch' | 'detent' | 'knob' = 'switch'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = kind === 'knob' ? 1400 : kind === 'detent' ? 2600 : 3600;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const peak = kind === 'knob' ? 0.05 : 0.14;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'knob' ? 0.06 : 0.035));
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.1);
  }

  /** Called every frame with the current state of the aeroplane. */
  update(sim: Simulation): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const smooth = 0.06;

    const rpm = sim.engine.rpm;
    const cranking = sim.electrical.starterTorque > 0.05 && !sim.engine.isRunning;
    const burning = sim.engine.state === 'running' || sim.engine.state === 'catching';

    // Starter whine, pitched by how hard the battery can turn it.
    if (this.starterGain && this.starterOsc) {
      this.starterGain.gain.setTargetAtTime(cranking ? 0.1 : 0, t, smooth);
      this.starterOsc.frequency.setTargetAtTime(
        70 + sim.electrical.starterTorque * 70,
        t,
        smooth,
      );
    }

    // Combustion. Frequency is the firing rate; the filter opens with RPM so
    // the note hardens as the engine comes up to speed.
    if (this.engineGain && this.engineOsc && this.engineHarm && this.engineFilter) {
      const fundamental = Math.max(8, (rpm / 60) * (sim.definition.systems.engine.cylinders / 2));
      this.engineOsc.frequency.setTargetAtTime(fundamental, t, smooth);
      this.engineHarm.frequency.setTargetAtTime(fundamental * 2, t, smooth);
      this.engineFilter.frequency.setTargetAtTime(280 + (rpm / 2700) * 2200, t, smooth);
      this.engineGain.gain.setTargetAtTime(burning ? 0.2 : 0, t, burning ? 0.04 : 0.25);
    }

    // Exhaust and propeller wash.
    if (this.exhaustGain && this.exhaustFilter) {
      this.exhaustGain.gain.setTargetAtTime(burning ? 0.06 + (rpm / 2700) * 0.1 : 0, t, 0.12);
      this.exhaustFilter.frequency.setTargetAtTime(300 + (rpm / 2700) * 1600, t, smooth);
    }

    // Gyro whine rises as the instruments spool up.
    if (this.gyroGain && this.gyroOsc) {
      const spool = Math.max(sim.vacuum.gyroSpool, sim.vacuum.turnCoordinatorSpool);
      this.gyroGain.gain.setTargetAtTime(spool * GYRO_PEAK_GAIN, t, 0.3);
      this.gyroOsc.frequency.setTargetAtTime(GYRO_BASE_HZ + spool * GYRO_SPOOL_HZ, t, 0.3);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** One second of white noise, reused by every noise source. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
