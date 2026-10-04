// The rack's signal path for anything we can actually touch (Plex audio and
// video play through <audio>/<video> elements on our own origin):
//
//   media element → 10-band graphic EQ → DSP (loudness / reverb) → master gain → analyser → speakers
//
// Spotify and YouTube play inside sandboxes we can't tap, so the spectrum
// analyzer falls back to a convincing simulation for those inputs.

import { DSP_MODES, EQ_BANDS, getState, outputGain } from './store';

let ctx: AudioContext | null = null;
let eqNodes: BiquadFilterNode[] = [];
let master: GainNode;
let dspIn: GainNode;
let dry: GainNode;
let wet: GainNode;
let convolver: ConvolverNode;
let loudLow: BiquadFilterNode;
let loudHigh: BiquadFilterNode;
let analyser: AnalyserNode;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function impulse(c: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function graph() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  eqNodes = EQ_BANDS.map((f, i) => {
    const n = ctx!.createBiquadFilter();
    n.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    n.frequency.value = f;
    n.Q.value = 1.1;
    return n;
  });
  for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);

  loudLow = ctx.createBiquadFilter();
  loudLow.type = 'lowshelf';
  loudLow.frequency.value = 100;
  loudHigh = ctx.createBiquadFilter();
  loudHigh.type = 'highshelf';
  loudHigh.frequency.value = 9000;
  dspIn = ctx.createGain();
  dry = ctx.createGain();
  wet = ctx.createGain();
  convolver = ctx.createConvolver();
  master = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.75;

  eqNodes.at(-1)!.connect(loudLow).connect(loudHigh).connect(dspIn);
  dspIn.connect(dry).connect(master);
  dspIn.connect(convolver).connect(wet).connect(master);
  master.connect(analyser).connect(ctx.destination);
  applySettings();
  return ctx;
}

/** Route a media element through the rack. Safe to call repeatedly. */
export function attachMedia(el: HTMLMediaElement) {
  const c = graph();
  if (!sources.has(el)) {
    const src = c.createMediaElementSource(el);
    src.connect(eqNodes[0]);
    sources.set(el, src);
  }
  el.volume = 1; // master gain does the work so the analyser sees the true level
  if (c.state === 'suspended') c.resume();
}

export function applySettings() {
  if (!ctx) return;
  const s = getState();
  const t = ctx.currentTime;
  s.eq.forEach((db, i) => eqNodes[i].gain.setTargetAtTime(db, t, 0.03));
  master.gain.setTargetAtTime(outputGain(s), t, 0.03);

  const mode = DSP_MODES.includes(s.dsp) ? s.dsp : 'DIRECT';
  const loud = mode === 'LOUDNESS' ? 1 : 0;
  loudLow.gain.setTargetAtTime(loud * 8, t, 0.05);
  loudHigh.gain.setTargetAtTime(loud * 4, t, 0.05);
  const reverb: Record<string, [number, number, number]> = {
    HALL: [2.6, 2.5, 0.35],
    'JAZZ CLUB': [0.9, 3.5, 0.25],
    STADIUM: [4.5, 1.6, 0.45],
  };
  const r = reverb[mode];
  if (r) {
    if ((convolver as ConvolverNode & { _mode?: string })._mode !== mode) {
      convolver.buffer = impulse(ctx, r[0], r[1]);
      (convolver as ConvolverNode & { _mode?: string })._mode = mode;
    }
    wet.gain.setTargetAtTime(r[2], t, 0.05);
    dry.gain.setTargetAtTime(1 - r[2] * 0.4, t, 0.05);
  } else {
    wet.gain.setTargetAtTime(0, t, 0.05);
    dry.gain.setTargetAtTime(1, t, 0.05);
  }
}

// ── Spectrum ───────────────────────────────────────────────────────────

let freqData: Uint8Array<ArrayBuffer> | null = null;
const sims = new Map<number, number[]>();

/**
 * Levels 0..1 for `bands` log-spaced bands. `live` means a real signal from
 * a Plex element; otherwise we synthesize something music-shaped when the
 * active deck is playing (Spotify / YouTube / games).
 */
export function spectrum(bands: number, live: boolean, playing: boolean): number[] {
  if (live && ctx && analyser) {
    if (!freqData) freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
    const nyquist = ctx.sampleRate / 2;
    const out: number[] = [];
    for (let b = 0; b < bands; b++) {
      const lo = 30 * Math.pow(16000 / 30, b / bands);
      const hi = 30 * Math.pow(16000 / 30, (b + 1) / bands);
      const i0 = Math.floor((lo / nyquist) * freqData.length);
      const i1 = Math.max(i0 + 1, Math.ceil((hi / nyquist) * freqData.length));
      let m = 0;
      for (let i = i0; i < i1; i++) m = Math.max(m, freqData[i]);
      out.push(m / 255);
    }
    return out;
  }

  let sim = sims.get(bands);
  if (!sim) sims.set(bands, (sim = Array(bands).fill(0)));
  const now = performance.now() / 1000;
  const gain = outputGain() > 0 ? Math.min(1, 0.35 + outputGain() * 1.4) : 0;
  const beat = Math.pow(Math.max(0, Math.sin(now * Math.PI * 2 * 1.02)), 8);
  const eq = getState().eq;
  for (let b = 0; b < bands; b++) {
    const x = b / bands;
    const eqBoost = 1 + eq[Math.min(9, Math.floor(x * 10))] / 24;
    const shape = 0.85 - x * 0.45 + (x < 0.2 ? beat * 0.35 : 0);
    const wobble = 0.5 + 0.5 * Math.sin(now * (3 + b * 0.7) + b * 1.3) * Math.sin(now * 1.7 + b);
    const target = playing ? Math.min(1, shape * (0.55 + wobble * 0.5) * gain * eqBoost + Math.random() * 0.08) : 0;
    sim[b] += (target - sim[b]) * (target > sim[b] ? 0.6 : 0.15);
  }
  return sim.slice();
}
