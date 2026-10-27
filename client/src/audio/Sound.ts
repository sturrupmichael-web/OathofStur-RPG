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
  | 'build'
  | 'fletch'
  | 'light'
  | 'ignite'
  | 'clean'
  | 'mix'
  | 'drink'
  | 'bury'
  | 'scatter'
  | 'pray'
  | 'offer'
  | 'prayer_on'
  | 'prayer_off'
  | 'balance'
  | 'jump'
  | 'climb'
  | 'rope_swing'
  | 'crawl'
  | 'fall'
  | 'inscribe'
  | 'inscribe_done'
  | 'rake'
  | 'dig'
  | 'plant'
  | 'pick'
  | 'spread'
  | 'pour'
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
  | 'click'
  | 'cast_wind'
  | 'cast_tide'
  | 'cast_root'
  | 'cast_ember'
  | 'spell_hit'
  | 'splash'
  | 'teleport'
  | 'arrive'
  | 'recall'
  | 'gild'
  | 'forge'
  | 'autocast';

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
  // Hammer on a nail in wood: a sharp tap over a hollow knock.
  build: (v) => {
    v.tone('square', 1400, 900, 0.1, 0, 0.001, 0.03);
    v.tone('sine', 420, 220, 0.5, 0, 0.003, 0.12);
    v.hiss('bandpass', 1500, 900, 0.35, 0, 0.002, 0.07, 2);
  },
  // Knife shaving wood: a short dry scrape.
  fletch: (v) => {
    v.hiss('bandpass', 3200, 1900, 0.4, 0, 0.03, 0.22, 2.5);
    v.hiss('highpass', 5000, 4000, 0.12, 0.05, 0.02, 0.18);
  },
  // Tinderbox: a sharp click of flint on steel with a spit of sparks.
  light: (v) => {
    v.tone('square', 2600, 1900, 0.12, 0, 0.001, 0.03);
    v.hiss('highpass', 6000, 3500, 0.35, 0, 0.002, 0.09);
  },
  // The logs catching: a soft whoomph and a crackle.
  ignite: (v) => {
    v.hiss('lowpass', 400, 1600, 0.6, 0, 0.12, 0.6);
    for (const s of [0.15, 0.27, 0.42, 0.5]) v.hiss('bandpass', 3500, 2500, 0.3, s, 0.002, s + 0.03, 3);
  },
  // Rubbing dirt off a herb: a soft papery rustle.
  clean: (v) => {
    v.hiss('bandpass', 2600, 3400, 0.18, 0, 0.03, 0.18, 1.5);
    v.hiss('bandpass', 3000, 2400, 0.14, 0.16, 0.03, 0.32, 1.5);
  },
  // Mixing: a clink of glass, then a little bubbling.
  mix: (v) => {
    v.tone('sine', 3100, 3050, 0.16, 0, 0.002, 0.18);
    v.tone('sine', 4650, 4600, 0.07, 0, 0.002, 0.12);
    for (const s of [0.12, 0.2, 0.31]) v.tone('sine', 380 + Math.random() * 200, 900, 0.12, s, 0.005, s + 0.05);
  },
  // Three gulps.
  drink: (v) => {
    for (const s of [0.35, 0.6, 0.85]) v.tone('sine', 260, 140, 0.4, s, 0.01, s + 0.11);
  },
  // Soil scraped and patted down.
  bury: (v) => {
    for (const s of [0, 0.2, 0.4]) v.hiss('lowpass', 900, 350, 0.4, s, 0.01, s + 0.12);
    for (const s of [0.8, 1.0]) v.tone('sine', 120, 80, 0.4, s, 0.005, s + 0.09);
  },
  // Ashes on the wind.
  scatter: (v) => v.hiss('bandpass', 600, 2400, 0.3, 0.2, 0.15, 0.8, 0.7),
  // Kneeling at an altar: a soft, rising chord.
  pray: (v) => {
    v.tune('sine', [[392, 0, 1.6], [494, 0.12, 1.5], [587, 0.24, 1.4], [784, 0.5, 1.1]], 0.12);
    v.hiss('highpass', 7000, 6000, 0.04, 0.2, 0.4, 1.4);
  },
  // Bones laid on the altar: a single bell.
  offer: (v) => {
    v.tone('sine', 880, 878, 0.18, 0, 0.003, 1.0);
    v.tone('sine', 2210, 2200, 0.06, 0, 0.003, 0.6);
  },
  // Agility: the log creaks underfoot.
  balance: (v) => {
    v.tone('triangle', 120, 95, 0.25, 0.05, 0.05, 0.5, 6);
    v.tone('triangle', 140, 110, 0.18, 0.9, 0.05, 1.3, 6);
  },
  // A push off and a landing.
  jump: (v) => {
    v.hiss('bandpass', 900, 1800, 0.25, 0, 0.02, 0.18, 1.5);
    v.hiss('lowpass', 500, 200, 0.45, 0.55, 0.005, 0.7);
  },
  // Rope and wood: a few creaky grabs.
  climb: (v) => {
    for (const s of [0, 0.45, 0.9, 1.35]) v.hiss('bandpass', 1400, 900, 0.22, s, 0.01, s + 0.12, 3);
  },
  // The rope's whoosh through the air.
  rope_swing: (v) => v.hiss('bandpass', 400, 1600, 0.4, 0.1, 0.4, 1.2, 1.2),
  // Shuffling through a pipe: muffled scrapes.
  crawl: (v) => {
    for (const s of [0, 0.5, 1.0, 1.5, 2.0]) v.hiss('lowpass', 700, 400, 0.3, s, 0.03, s + 0.2);
  },
  // Falling off: a yelp of air, then a thump in the mud.
  fall: (v) => {
    v.hiss('bandpass', 1800, 600, 0.25, 0, 0.02, 0.25, 2);
    v.tone('sine', 110, 50, 0.8, 0.25, 0.003, 0.5);
    v.hiss('lowpass', 600, 150, 0.6, 0.25, 0.003, 0.55);
  },
  // Inscribing: a soft shimmer as the shards catch the shrine's light.
  inscribe: (v) => {
    v.tone('sine', 1320, 1360, 0.08, 0, 0.05, 0.5);
    v.tone('sine', 1980, 2040, 0.05, 0.05, 0.05, 0.45);
  },
  // The glyphs take: a bright little arpeggio.
  inscribe_done: (v) => v.tune('sine', [[784, 0, 0.3], [988, 0.08, 0.3], [1319, 0.16, 0.5]], 0.12),
  // Spells leaving the hand, one sound per element: a gust, a gush, a grinding rush, a roar of flame.
  cast_wind: (v) => {
    v.hiss('bandpass', 600, 2600, 0.4, 0, 0.06, 0.45, 2);
    v.tone('sine', 700, 1400, 0.05, 0, 0.05, 0.35);
  },
  cast_tide: (v) => {
    v.hiss('lowpass', 2400, 700, 0.45, 0, 0.03, 0.4, 1.2);
    v.tone('sine', 520, 260, 0.08, 0.02, 0.03, 0.3, 18);
  },
  cast_root: (v) => {
    v.hiss('lowpass', 500, 180, 0.6, 0, 0.02, 0.45, 2);
    v.tone('triangle', 140, 70, 0.12, 0, 0.02, 0.35);
  },
  cast_ember: (v) => {
    v.hiss('bandpass', 900, 400, 0.55, 0, 0.04, 0.45, 0.8);
    v.tone('sawtooth', 180, 120, 0.05, 0, 0.04, 0.35, 9);
  },
  // A spell striking home, and one fizzling out against its target.
  spell_hit: (v) => {
    v.hiss('lowpass', 1800, 300, 0.7, 0, 0.003, 0.3);
    v.tone('sine', 300, 90, 0.15, 0, 0.003, 0.25);
  },
  splash: (v) => {
    v.hiss('highpass', 2500, 5000, 0.25, 0, 0.005, 0.25);
    v.tone('sine', 900, 400, 0.04, 0, 0.005, 0.2);
  },
  // Teleporting away: a rising shimmer. Arriving: it settles.
  teleport: (v) => {
    v.tune('sine', [[523, 0, 0.5], [659, 0.1, 0.5], [784, 0.2, 0.5], [1047, 0.3, 0.8]], 0.08);
    v.hiss('bandpass', 1500, 6000, 0.18, 0.1, 0.4, 1.4, 3);
  },
  arrive: (v) => {
    v.tone('sine', 1568, 784, 0.07, 0, 0.01, 0.6);
    v.hiss('bandpass', 5000, 1200, 0.15, 0, 0.01, 0.5, 3);
  },
  // The Hearth Recall chant: a low hum that swells.
  recall: (v) => {
    v.tone('triangle', 196, 196, 0.07, 0, 0.4, 1.4, 4);
    v.tone('sine', 294, 294, 0.05, 0.1, 0.4, 1.4, 3);
  },
  // Gilding: a chime and the clink of new coins.
  gild: (v) => {
    v.tune('sine', [[1319, 0, 0.3], [1760, 0.06, 0.4]], 0.07);
    v.tone('square', 3200, 2800, 0.03, 0.35, 0.002, 0.42);
    v.tone('square', 3600, 3100, 0.03, 0.45, 0.002, 0.52);
  },
  // Forge Touch: a whoomph of heat and a hiss.
  forge: (v) => {
    v.hiss('lowpass', 300, 1500, 0.6, 0, 0.08, 0.5, 1);
    v.hiss('highpass', 3000, 6000, 0.15, 0.3, 0.05, 0.8);
  },
  // Picking a spell for the staff.
  autocast: (v) => v.tune('sine', [[880, 0, 0.12], [1175, 0.07, 0.2]], 0.08),
  // Rake tines dragged through soil.
  rake: (v) => v.hiss('bandpass', 1800, 1200, 0.3, 0, 0.05, 0.35, 1.5),
  // A spade bites into earth.
  dig: (v) => {
    v.tone('square', 900, 600, 0.06, 0, 0.002, 0.04);
    v.hiss('lowpass', 1200, 400, 0.45, 0, 0.005, 0.22);
  },
  // A dibber poking a hole.
  plant: (v) => v.hiss('lowpass', 800, 400, 0.3, 0, 0.005, 0.1),
  // A stalk snapped off.
  pick: (v) => {
    v.hiss('highpass', 4000, 3000, 0.25, 0, 0.002, 0.05);
    v.hiss('bandpass', 2400, 2000, 0.15, 0.04, 0.02, 0.16, 2);
  },
  // Compost tipped out of a bucket.
  spread: (v) => v.hiss('lowpass', 900, 300, 0.45, 0.45, 0.1, 0.9),
  // A trickle from a vial.
  pour: (v) => {
    for (const s of [0.2, 0.3, 0.42, 0.55, 0.7]) v.tone('sine', 900 + Math.random() * 500, 1400, 0.06, s, 0.005, s + 0.05);
  },
  prayer_on: (v) => v.tune('sine', [[659, 0, 0.12], [988, 0.08, 0.3]], 0.16),
  prayer_off: (v) => v.tune('sine', [[784, 0, 0.1], [523, 0.07, 0.22]], 0.12),
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
