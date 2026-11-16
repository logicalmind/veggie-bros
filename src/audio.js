// Web Audio synth: SFX, music loop, mute.
//
// Lazily initialized on first user gesture (Enter on title); if
// AudioContext is unavailable every method is a no-op. Master gain 0.5.
// No dependencies; no document/window access — safe to import in Node.

const MASTER_LEVEL = 0.5;   // master gain (unmuted)
const SFX_PEAK = 0.4;       // per-oscillator peak gain for SFX
const ATTACK = 0.005;       // s, linear attack to peak
const FLOOR = 0.0001;       // exp-decay target (ramps can't reach 0)

const BPM = 132;
const EIGHTH = 60 / BPM / 2; // s per 8th note
const LOOKAHEAD_MS = 30;     // scheduler timer period
const SCHEDULE_AHEAD = 0.12; // s of music scheduled in advance

const MELODY_PEAK = 0.16;    // square, per architecture
const BASS_PEAK = 0.2;       // triangle, per architecture

// Standard frequencies for every note the spec uses (F3/C3/E6 added:
// required by the die jingle, bass bar 4, and clear/win jingles).
const N = {
  C2: 65.41, F2: 87.31, G2: 98, A2: 110,
  C3: 130.81, E3: 164.81, F3: 174.61, A3: 220,
  D3: 146.83, C4: 261.63, F4: 349.23, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46,
  G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.51,
};

// 4-bar I-V-vi-IV, 8th-note resolution. Each bar "X - Y - Z - W -" fills
// 8 slots as [X, null, Y, null, Z, null, W, null]; 4 bars -> 32 slots.
const MELODY = [
  N.C5, null, N.E5, null, N.G5, null, N.E5, null, // bar 1
  N.G5, null, N.B5, null, N.D5, null, N.B5, null, // bar 2
  N.A5, null, N.C6, null, N.E5, null, N.C6, null, // bar 3
  N.F5, null, N.A5, null, N.C6, null, N.A5, null, // bar 4
];

// Root + fifth per bar, each note held for 4 eighths (32 slots).
const BASS = [
  N.C2, N.C2, N.C2, N.C2, N.G2, N.G2, N.G2, N.G2, // bar 1
  N.G2, N.G2, N.G2, N.G2, N.D3, N.D3, N.D3, N.D3, // bar 2
  N.A2, N.A2, N.A2, N.A2, N.E3, N.E3, N.E3, N.E3, // bar 3
  N.F2, N.F2, N.F2, N.F2, N.C3, N.C3, N.C3, N.C3, // bar 4
];

let inited = false;
let ctx = null;
let master = null;
let musicTimer = null;    // scheduler setInterval id, or null
let musicSlot = 0;        // next 8th slot to schedule (wraps at 32)
let musicNextTime = 0;    // ctx time of musicSlot

// One oscillator + gain envelope: 0.005 s linear attack to peak,
// exponential decay to FLOOR at t0 + dur. Optional freq glide to glideTo.
function scheduleTone(type, peak, freq, t0, dur, glideTo) {
  const tEnd = t0 + dur;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, tEnd);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + ATTACK);
  gain.gain.exponentialRampToValueAtTime(FLOOR, tEnd);

  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(tEnd);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

// White-noise burst: buffer -> lowpass -> same gain envelope -> master.
function scheduleNoise(t0, dur, filterHz) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, t0);
  gain.gain.linearRampToValueAtTime(SFX_PEAK, t0 + ATTACK);
  gain.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
  src.stop(t0 + dur);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

// Browsers may hand back a suspended context (no user gesture yet, or the tab
// was hidden); without resume() nothing ever sounds. Swallow the rejection so
// a blocked resume can't produce an unhandled promise error.
function resumeCtx() {
  if (!ctx || ctx.state !== "suspended") return;
  const p = ctx.resume();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

// Sequential square jingle: one note per step, each step long.
function scheduleJingle(freqs, step, t0) {
  for (let i = 0; i < freqs.length; i += 1) {
    scheduleTone("square", SFX_PEAK, freqs[i], t0 + i * step, step);
  }
}

export const audio = {
  muted: false,

  init() {
    if (inited || typeof AudioContext === "undefined") return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    master.connect(ctx.destination);
    inited = true;
    resumeCtx();
  },

  // Muting before init() is remembered: init() applies it to the master gain.
  toggleMute() {
    this.muted = !this.muted;
    if (inited) master.gain.value = this.muted ? 0 : MASTER_LEVEL;
  },

  sfx(name) {
    if (!inited) return;
    const t0 = ctx.currentTime;
    switch (name) {
      case "jump":
        scheduleTone("square", SFX_PEAK, 320, t0, 0.12, 640);
        break;
      case "stomp":
        scheduleTone("triangle", SFX_PEAK, 200, t0, 0.15, 60);
        break;
      case "coin":
        scheduleTone("square", SFX_PEAK, N.B5, t0, 0.05);
        scheduleTone("square", SFX_PEAK, N.E6, t0 + 0.05, 0.25);
        break;
      case "power":
        scheduleJingle([N.C5, N.E5, N.G5, N.C6], 0.06, t0);
        break;
      case "break":
        scheduleNoise(t0, 0.15, 800);
        break;
      case "bump":
        scheduleTone("square", SFX_PEAK, 110, t0, 0.08);
        break;
      case "hurt":
        scheduleTone("sawtooth", SFX_PEAK, 400, t0, 0.3, 100);
        break;
      case "die":
        scheduleJingle([N.B4, N.F4, N.C4, N.A3, N.F3], 0.12, t0);
        break;
      case "clear":
        scheduleJingle([N.C5, N.E5, N.G5, N.C6, N.E6], 0.1, t0);
        break;
      case "win":
        scheduleJingle([N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6], 0.15, t0);
        break;
      case "bossHit":
        scheduleTone("square", SFX_PEAK, 150, t0, 0.1);
        break;
    }
  },

  // Lookahead scheduler: 30 ms tick, schedule 0.12 s ahead. The 4-bar
  // pattern loops (slot wraps at 32) until musicStop().
  musicStart() {
    if (!inited) return;
    resumeCtx();
    clearInterval(musicTimer);
    musicSlot = 0;
    musicNextTime = ctx.currentTime + 0.05;
    musicTimer = setInterval(() => {
      // A throttled tick (backgrounded tab) lets musicNextTime fall far behind
      // the audio clock; resync instead of firing a burst of past-dated notes.
      if (musicNextTime < ctx.currentTime) musicNextTime = ctx.currentTime + 0.05;
      while (musicNextTime < ctx.currentTime + SCHEDULE_AHEAD) {
        const mel = MELODY[musicSlot];
        if (mel !== null) {
          scheduleTone("square", MELODY_PEAK, mel, musicNextTime, EIGHTH);
        }
        // Bass notes start every 4th slot and hold for 4 eighths.
        if (musicSlot % 4 === 0) {
          scheduleTone("triangle", BASS_PEAK, BASS[musicSlot], musicNextTime, EIGHTH * 4);
        }
        musicSlot = (musicSlot + 1) % MELODY.length;
        musicNextTime += EIGHTH;
      }
    }, LOOKAHEAD_MS);
  },

  musicStop() {
    clearInterval(musicTimer);
    musicTimer = null;
  },
};
