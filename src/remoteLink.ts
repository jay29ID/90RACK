// Rack side of the phone remote: listens for commands from the server relay
// and publishes a snapshot of the rack whenever it changes.

import { soundBlocked } from './audio';
import { loadCd } from './decks/cd';
import { loadDvd } from './decks/dvd';
import { loadCart } from './decks/game';
import { getPresets, tune } from './decks/tuner';
import { getTapes, loadTape, recordTape } from './decks/vcr';
import { powerToggle } from './rack';
import type { Command, RackState } from './remote/protocol';
import { loadShelves } from './shelves';
import { isLoggedIn } from './sources/spotify';
import { DSP_MODES, getState, selectInput, setState, subscribe, transport, volumeDb } from './store';

function run(cmd: Command) {
  if (cmd.type === 'shelvesChanged') return loadShelves();
  const s = getState();
  // Anything but POWER wakes the rack first, like a real remote's input keys.
  if (cmd.type !== 'power' && !s.power) powerToggle();
  const t = transport();
  switch (cmd.type) {
    case 'power':
      return powerToggle();
    case 'input':
      return selectInput(cmd.input);
    case 'volume': {
      const v = cmd.value ?? s.volume + (cmd.delta ?? 0);
      return setState({ volume: Math.max(0, Math.min(100, Math.round(v))), muted: false });
    }
    case 'mute':
      return setState({ muted: !s.muted });
    case 'toggle':
      return t?.toggle();
    case 'stop':
      return t?.stop();
    case 'next':
      return t?.next ? t.next() : t?.seek?.(30);
    case 'prev':
      return t?.prev ? t.prev() : t?.seek?.(-30);
    case 'eject':
      return t?.eject?.();
    case 'seek':
      return t?.seek?.(cmd.seconds);
    case 'theater':
      return setState({ theater: !s.theater });
    case 'crt':
      return setState({ crt: !s.crt });
    case 'shelf':
      return setState({ shelfOpen: !s.shelfOpen });
    case 'dsp':
      return setState({ dsp: DSP_MODES[(DSP_MODES.indexOf(s.dsp) + 1) % DSP_MODES.length] });
    case 'cdMode':
      return setState({ cdMode: s.cdMode === 'normal' ? 'shuffle' : s.cdMode === 'shuffle' ? 'repeat' : 'normal' });
    case 'cdSlot':
      if (s.cdSlots[cmd.slot]) setState({ cdSlot: cmd.slot, cdLoadId: Date.now(), input: 'cd' });
      return;
    case 'loadDvd':
      return loadDvd(cmd.item);
    case 'loadCd':
      return loadCd(cmd.item);
    case 'tune': {
      const p = getPresets().find((x) => x.uri === cmd.uri);
      return p && tune(p);
    }
    case 'loadTape':
      recordTape(cmd.tape);
      return loadTape(cmd.tape);
    case 'loadCart':
      return loadCart(cmd.rom);
  }
}

function snapshot(): RackState {
  const s = getState();
  return {
    power: s.power,
    input: s.input,
    volume: s.volume,
    volumeDb: volumeDb(s.volume),
    muted: s.muted,
    theater: s.theater,
    crt: s.crt,
    shelfOpen: s.shelfOpen,
    dsp: s.dsp,
    cdMode: s.cdMode,
    cdSlot: s.cdSlot,
    cdSlots: s.cdSlots.map((a) => (a ? { ratingKey: a.ratingKey, title: a.title, artist: a.parentTitle } : null)),
    now: s.now[s.input] ?? null,
    presets: getPresets(),
    tunerUri: s.tunerUri,
    spotify: isLoggedIn(),
    tapes: getTapes().slice(0, 60),
    soundBlocked: soundBlocked(),
  };
}

export function startRemoteLink() {
  const es = new EventSource('/api/remote/rack');
  es.onmessage = (e) => {
    try {
      run(JSON.parse(e.data) as Command);
    } catch (err) {
      console.warn('remote command failed', err);
    }
  };

  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const publish = () => {
    timer = null;
    const body = JSON.stringify(snapshot());
    if (body === last) return;
    last = body;
    fetch('/api/remote/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {
      last = '';
    });
  };
  const schedule = () => {
    timer ??= setTimeout(publish, 250);
  };
  subscribe(schedule);
  // Presets and tapes live outside the store, and a phone that just joined
  // needs a fresh copy: re-check every couple of seconds as well.
  setInterval(() => {
    last = es.readyState === EventSource.OPEN ? last : '';
    schedule();
  }, 2000);
  es.onopen = () => {
    last = '';
    schedule();
  };
}
