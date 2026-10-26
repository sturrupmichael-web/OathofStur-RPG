/**
 * Sound effects, made on the fly with WebAudio so the game still ships with
 * no audio files. Each effect is a short recipe of oscillators and filtered
 * noise. Browsers only allow sound after the player has clicked or pressed a
 * key, so nothing plays until `unlock()` has run from one of those.
 */
export type SoundName =
  | 'chop'
  | 'mine'
  | 'net'
  | 'rod'
  | 'cook'
  | 'smelt'
  | 'smith'
  | 'fletch'
  | 'shoot'
  | 'swing'
  | 'punch'
  | 'hit'
  | 'miss'
  | 'eat'
  | 'death'
  | 'monster_death'
  | 'bite'
  | 'sting'
  | 'peck'
  | 'moo'
  | 'wail'
  | 'roar'
  | 'breath'
  | 'levelup'
  | 'quest'
  | 'quest_complete'
  | 'coins'
  | 'click';

const STORE_KEY = 'oathofstur.sound';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.7;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { on?: boolean; volume?: number } | null;
      if (saved) {
        this.enabled = saved.on !== false;
        if (typeof saved.volume === 'number') this.volume = Math.min(1, Math.max(0, saved.volume));
      }
    } catch {
      // No storage (private browsing): keep the defaults.
    }
  }

  /** Call from a click or key press: browsers keep audio locked until then. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      // Two seconds of white noise, shared by every effect that hisses, crunches or splashes.
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  set(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ on: this.enabled, volume: this.volume }));
    } catch {
      // Not saved; it still applies for this visit.
    }
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.enabled ? this.volume * 0.6 : 0;
  }

  /** Plays an effect. `gain` scales it (distance); `pitch` shifts it (bigger hits sound lower). */
  play(name: SoundName, gain = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled || gain <= 0.01 || ctx.state !== 'running') return;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    RECIPES[name](new Voice(ctx, out, this.noise!, pitch));
  }
}

/** Building blocks for one effect, all routed into one output. */
class Voice {
  readonly t: number;
  constructor(
    readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noiseBuffer: AudioBuffer,
    readonly pitch: number,
  ) {
    this.t = ctx.currentTime + 0.005;
  }

  /** An envelope: silent, up to `peak` over `attack`, then down to nothing by `end`. */
  private env(peak: number, start: number, attack: number, end: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.t + start);
    g.gain.exponentialRampToValueAtTime(peak, this.t + start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + end);
    g.connect(this.out);
    return g;
  }

  /** A tone gliding from `from` to `to` Hz. */
  tone(type: OscillatorType, from: number, to: number, peak: number, start: number, attack: number, end: number, vibrato = 0): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from * this.pitch, this.t + start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to * this.pitch), this.t + end);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(this.t + start);
      lfo.stop(this.t + end + 0.05);
    }
    osc.connect(this.env(peak, start, attack, end));
    osc.start(this.t + start);
    osc.stop(this.t + end + 0.05);
  }

  /** Filtered noise; the filter frequency glides from `from` to `to`. */
  hiss(filter: BiquadFilterType, from: number, to: number, peak: number, start: number, attack: number, end: number, q = 1): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from * this.pitch, this.t + start);
    f.frequency.exponentialRampToValueAtTime(to * this.pitch, this.t + end);
    src.connect(f).connect(this.env(peak, start, attack, end));
    src.start(this.t + start, Math.random() * 1.5);
    src.stop(this.t + end + 0.05);
  }

  /** A short tune: [frequency, start, length] notes. */
  tune(type: OscillatorType, notes: [number, number, number][], peak: number): void {
    for (const [f, start, len] of notes) this.tone(type, f, f, peak, start, 0.02, start + len);
  }
}

const RECIPES: Record<SoundName, (v: Voice) => void> = {
  // Axe into wood: a dull knock with a woody body.
  chop: (v) => {
    v.hiss('lowpass', 900, 300, 0.9, 0, 0.004, 0.14);
    v.tone('sine', 190, 90, 0.7, 0, 0.004, 0.16);
  },
  // Pickaxe on rock: a bright clink over a short crack.
  mine: (v) => {
    v.hiss('highpass', 2500, 1500, 0.5, 0, 0.002, 0.06);
    v.tone('sine', 1850, 1800, 0.35, 0, 0.002, 0.28);
    v.tone('sine', 2710, 2650, 0.2, 0, 0.002, 0.2);
  },
  net: (v) => v.hiss('bandpass', 1800, 500, 0.7, 0, 0.03, 0.4, 0.8),
  // A plop as the float bobs and the line is tugged.
  rod: (v) => {
    v.tone('sine', 520, 160, 0.5, 0, 0.005, 0.12);
    v.hiss('bandpass', 1200, 700, 0.2, 0.02, 0.01, 0.2, 2);
  },
  cook: (v) => v.hiss('highpass', 4200, 3000, 0.25, 0, 0.05, 0.6, 0.5),
  smelt: (v) => {
    v.hiss('lowpass', 300, 700, 0.8, 0, 0.18, 0.7);
    v.tone('sine', 60, 50, 0.3, 0, 0.15, 0.7);
  },
  // Hammer on anvil: a ringing, slightly out-of-tune bell.
  smith: (v) => {
    v.tone('sine', 1180, 1170, 0.45, 0, 0.002, 0.5);
    v.tone('sine', 3230, 3200, 0.18, 0, 0.002, 0.3);
    v.hiss('highpass', 3000, 2000, 0.4, 0, 0.002, 0.04);
  },
  // Knife shaving wood: a short dry scrape.
  fletch: (v) => {
    v.hiss('bandpass', 3200, 1900, 0.4, 0, 0.03, 0.22, 2.5);
    v.hiss('highpass', 5000, 4000, 0.12, 0.05, 0.02, 0.18);
  },
  // Bow: the creak of the draw, then the string's twang and the arrow's whoosh as it's loosed.
  shoot: (v) => {
    v.hiss('bandpass', 400, 700, 0.12, 0.1, 0.2, 0.5, 4);
    v.tone('triangle', 210, 150, 0.5, 0.54, 0.002, 0.8, 9);
    v.tone('sine', 420, 300, 0.2, 0.54, 0.002, 0.7);
    v.hiss('bandpass', 2400, 900, 0.3, 0.55, 0.01, 0.8, 1.2);
  },
  swing: (v) => v.hiss('bandpass', 700, 2600, 0.45, 0, 0.06, 0.2, 1.5),
  punch: (v) => v.hiss('bandpass', 500, 1400, 0.35, 0, 0.04, 0.15, 1.2),
  hit: (v) => {
    v.tone('sine', 170, 60, 0.9, 0, 0.003, 0.18);
    v.hiss('lowpass', 1500, 400, 0.6, 0, 0.003, 0.12);
  },
  miss: (v) => v.hiss('bandpass', 2200, 1200, 0.25, 0, 0.01, 0.1, 3),
  eat: (v) => {
    for (const s of [0, 0.16, 0.34]) v.hiss('bandpass', 2400, 1800, 0.45, s, 0.005, s + 0.07, 2);
  },
  death: (v) => v.tune('triangle', [[392, 0, 0.25], [330, 0.22, 0.25], [262, 0.44, 0.6]], 0.35),
  monster_death: (v) => {
    v.tone('sawtooth', 220, 70, 0.25, 0, 0.02, 0.5);
    v.hiss('lowpass', 800, 200, 0.3, 0, 0.02, 0.4);
  },
  bite: (v) => {
    v.hiss('bandpass', 3000, 1500, 0.6, 0, 0.003, 0.08, 2);
    v.tone('square', 260, 180, 0.15, 0, 0.003, 0.08);
  },
  sting: (v) => v.hiss('highpass', 5000, 2500, 0.35, 0, 0.01, 0.22),
  peck: (v) => v.tone('triangle', 2400, 1800, 0.3, 0, 0.002, 0.06),
  moo: (v) => {
    v.tone('sawtooth', 150, 115, 0.22, 0, 0.08, 0.75, 4);
    v.tone('sine', 300, 230, 0.12, 0, 0.08, 0.75);
  },
  wail: (v) => {
    v.tone('sine', 520, 760, 0.25, 0, 0.2, 1.1, 18);
    v.tone('sine', 523, 380, 0.15, 0.1, 0.2, 1.1, 12);
  },
  // The drake: a deep, rattling growl.
  roar: (v) => {
    v.tone('sawtooth', 95, 60, 0.4, 0, 0.06, 0.8, 12);
    v.hiss('lowpass', 600, 250, 0.5, 0, 0.06, 0.7);
  },
  // Fire breath: an in-drawn hiss, then a long roaring rush with crackle.
  breath: (v) => {
    v.hiss('bandpass', 900, 2200, 0.25, 0, 0.3, 0.42, 1);
    v.hiss('lowpass', 500, 1400, 0.9, 0.4, 0.12, 1.35);
    v.tone('sawtooth', 70, 55, 0.25, 0.4, 0.1, 1.3, 8);
    for (let i = 0; i < 6; i++) v.hiss('highpass', 3500, 3000, 0.25, 0.45 + i * 0.13 + Math.random() * 0.05, 0.003, 0.5 + i * 0.13 + Math.random() * 0.05);
  },
  levelup: (v) => v.tune('triangle', [[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.5]], 0.35),
  quest: (v) => v.tune('sine', [[784, 0, 0.18], [1175, 0.14, 0.4]], 0.3),
  quest_complete: (v) => {
    v.tune('triangle', [[392, 0, 0.18], [523, 0.16, 0.18], [659, 0.32, 0.18], [784, 0.48, 0.3], [659, 0.78, 0.15], [784, 0.92, 0.7]], 0.32);
    v.tune('sine', [[262, 0.48, 0.3], [330, 0.92, 0.7]], 0.2);
  },
  coins: (v) => {
    for (let i = 0; i < 4; i++) v.tone('sine', 2600 + i * 310, 2500 + i * 300, 0.12, i * 0.05, 0.002, i * 0.05 + 0.18);
  },
  click: (v) => v.tone('triangle', 900, 700, 0.12, 0, 0.002, 0.05),
};
