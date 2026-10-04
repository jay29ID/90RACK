import { useSyncExternalStore } from 'react';
import type { PlexItem } from './sources/plex';
import type { Tape } from './sources/youtube';

// ── Types ──────────────────────────────────────────────────────────────

export type Input = 'dvd' | 'cd' | 'tuner' | 'vcr' | 'game';

export const INPUTS: { id: Input; label: string; source: string }[] = [
  { id: 'dvd', label: 'DVD', source: 'Plex · Movies & TV' },
  { id: 'cd', label: 'CD', source: 'Plex · Music' },
  { id: 'tuner', label: 'TUNER', source: 'Spotify' },
  { id: 'vcr', label: 'VCR', source: 'YouTube' },
  { id: 'game', label: 'GAME', source: 'Emulators' },
];

export interface GameSystem {
  id: string;
  name: string;
  short: string;
  core: string;
  exts?: string[];
}

export interface Status {
  plex: boolean;
  spotifyClientId: string | null;
  youtubeApiKey: string | null;
  romCount: number;
  systems: GameSystem[];
}

export interface Rom {
  id: string;
  name: string;
  system: string;
  url: string;
}

export interface NowPlaying {
  title: string;
  subtitle?: string;
  art?: string;
  position: number; // seconds
  duration: number; // seconds
  playing: boolean;
  track?: number; // 1-based, for the VFDs
}

/** Each deck registers one of these so the receiver/remote can drive it. */
export interface Transport {
  toggle(): void;
  pause(): void;
  stop(): void;
  next?(): void;
  prev?(): void;
  seek?(deltaSeconds: number): void;
  eject?(): void;
}

export interface State {
  power: boolean;
  booting: boolean;
  input: Input;
  volume: number; // 0..100
  muted: boolean;
  theater: boolean;
  crt: boolean;
  lamp: boolean; // the warm room light behind the rack
  status: Status | null;
  now: Partial<Record<Input, NowPlaying>>;
  shelfOpen: boolean;
  eq: number[]; // 10 bands, -12..12 dB
  dsp: string;
  // What's physically loaded in each deck.
  dvd: PlexItem | null;
  cdSlots: (PlexItem | null)[]; // 5-disc carousel
  cdSlot: number;
  cdLoadId: number; // bumps when a disc should start playing
  cdMode: 'normal' | 'shuffle' | 'repeat';
  tape: Tape | null;
  cart: Rom | null;
  tunerUri: string | null;
}

export const DSP_MODES = ['DIRECT', 'LOUDNESS', 'HALL', 'JAZZ CLUB', 'STADIUM'];
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// ── Persistence ────────────────────────────────────────────────────────

const PERSIST_KEY = '90rack:prefs';
const persisted = ['input', 'volume', 'crt', 'lamp', 'eq', 'dsp', 'cdSlots', 'cdSlot', 'cdMode'] as const;

function loadPrefs(): Partial<State> {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
  } catch {
    return {};
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

// ── Store ──────────────────────────────────────────────────────────────

let state: State = {
  power: false,
  booting: false,
  input: 'dvd',
  volume: 40,
  muted: false,
  theater: false,
  crt: false,
  lamp: true,
  status: null,
  now: {},
  shelfOpen: true,
  eq: Array(10).fill(0),
  dsp: 'DIRECT',
  dvd: null,
  cdSlots: [null, null, null, null, null],
  cdSlot: 0,
  cdLoadId: 0,
  cdMode: 'normal',
  tape: null,
  cart: null,
  tunerUri: null,
  ...loadPrefs(),
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (persisted.some((k) => k in next)) {
    saveJson(PERSIST_KEY, Object.fromEntries(persisted.map((k) => [k, state[k]])));
  }
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
  );
}

export function setNow(input: Input, np: NowPlaying | null) {
  setState((s) => {
    const now = { ...s.now };
    if (np) now[input] = np;
    else delete now[input];
    return { now };
  });
}

export function patchNow(input: Input, patch: Partial<NowPlaying>) {
  setState((s) => {
    const cur = s.now[input];
    if (!cur) return {};
    return { now: { ...s.now, [input]: { ...cur, ...patch } } };
  });
}

// ── Transport registry ─────────────────────────────────────────────────

const transports: Partial<Record<Input, Transport>> = {};

export function registerTransport(input: Input, t: Transport) {
  transports[input] = t;
  return () => {
    if (transports[input] === t) delete transports[input];
  };
}

export function transport(input: Input = state.input): Transport | undefined {
  return transports[input];
}

/** Effective 0..1 gain after mute, with a gentle curve so the knob feels right. */
export function outputGain(s: State = state) {
  if (s.muted || !s.power) return 0;
  return Math.pow(s.volume / 100, 2);
}

/** Receiver-style volume readout: -80.0 dB … 0.0 dB. */
export function volumeDb(volume: number) {
  if (volume <= 0) return '-∞';
  return (20 * Math.log10(Math.pow(volume / 100, 2))).toFixed(1);
}

export function selectInput(input: Input) {
  if (state.input === input) {
    setState({ shelfOpen: true });
    return;
  }
  // Only one deck plays at a time, like a real source selector.
  transports[state.input]?.pause();
  setState({ input, shelfOpen: true, crt: input === 'game' ? true : state.crt });
}

export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}
