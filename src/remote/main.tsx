// The phone remote: a 90s universal remote for the rack, plus a browser for
// your shelves so you can pick what to play from the couch.

import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { PinButton } from '../components/PinButton';
import { Cover, Glyph } from '../components/ui';
import { itemId, loadShelves, useDisplay, type ShelfKind } from '../shelves';
import * as plex from '../sources/plex';
import type { PlexItem } from '../sources/plex';
import * as yt from '../sources/youtube';
import { INPUTS, fmtTime, type Input, type Rom, type Status } from '../store';
import type { Command, RackState } from './protocol';
import './remote.css';

// ── Link to the rack ───────────────────────────────────────────────────

function send(cmd: Command) {
  navigator.vibrate?.(12);
  fetch('/api/remote/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }).catch(() => {});
}

function useRack() {
  const [state, setState] = useState<RackState | null>(null);
  const [racks, setRacks] = useState(0);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const es = new EventSource('/api/remote/phone');
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { racks?: number; state?: RackState | null; shelvesChanged?: boolean };
      if (msg.shelvesChanged) return void loadShelves();
      setRacks(msg.racks ?? 0);
      if (msg.state) setState(msg.state);
    };
    return () => es.close();
  }, []);
  return { state, connected: online && racks > 0, online };
}

// ── Buttons ────────────────────────────────────────────────────────────

/** A rubber remote key. `repeat` keeps firing while held (volume, seek). */
function Key(props: { onPress: () => void; children: ReactNode; className?: string; repeat?: boolean; label?: string; lit?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    props.onPress();
    if (!props.repeat) return;
    const loop = (delay: number) => {
      timer.current = setTimeout(() => {
        props.onPress();
        loop(110);
      }, delay);
    };
    loop(420);
  };
  useEffect(() => stop, []);
  return (
    <div className="key-wrap">
      <button
        className={`key ${props.className ?? ''} ${props.lit ? 'lit' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onPress()}
        aria-label={props.label}
      >
        {props.children}
      </button>
      {props.label && <span className="key-label">{props.label}</span>}
    </div>
  );
}

// ── Browse ─────────────────────────────────────────────────────────────

function useLibrary<T>(load: () => Promise<T[]>, enabled: boolean) {
  const [all, setAll] = useState<T[] | null>(null);
  useEffect(() => {
    if (enabled && !all) load().then(setAll).catch(() => setAll([]));
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return all;
}

async function allPlex(kind: 'dvd' | 'cd') {
  const sections = await plex.sections();
  const want = kind === 'dvd' ? ['movie', 'show'] : ['artist'];
  const lists = await Promise.all(
    sections.filter((s) => want.includes(s.type)).map((s) => plex.items(s.key, s.type === 'movie' ? 1 : s.type === 'show' ? 2 : 9)),
  );
  return lists.flat();
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="r-search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />;
}

function PlexBrowser({ kind, plexOn }: { kind: 'dvd' | 'cd'; plexOn: boolean }) {
  const shelf = useDisplay(kind, plexOn, 40);
  const [q, setQ] = useState('');
  const library = useLibrary(() => (plexOn ? allPlex(kind) : Promise.resolve(kind === 'dvd' ? plex.DEMO_MOVIES : plex.DEMO_ALBUMS)), q.length > 0);
  const [show, setShow] = useState<PlexItem | null>(null);
  const [eps, setEps] = useState<PlexItem[] | null>(null);

  useEffect(() => {
    setEps(null);
    if (!show) return;
    plex.children(show.ratingKey).then(async (seasons) => {
      const all = await Promise.all(seasons.map((s) => plex.children(s.ratingKey)));
      setEps(all.flat());
    });
  }, [show]);

  const pick = (item: PlexItem) => {
    if (item.type === 'show') return setShow(item);
    send(kind === 'dvd' ? { type: 'loadDvd', item } : { type: 'loadCd', item });
  };

  if (show) {
    return (
      <div className="r-browse">
        <button className="r-back" onClick={() => setShow(null)}>
          ‹ {show.title}
        </button>
        {!eps && <p className="r-note">Loading episodes…</p>}
        <ol className="r-eps">
          {eps?.map((e) => (
            <li key={e.ratingKey}>
              <button onClick={() => send({ type: 'loadDvd', item: e })}>
                <span>
                  S{e.parentIndex}·E{e.index}
                </span>
                <b>{e.title}</b>
                {e.viewCount ? <i>✓</i> : null}
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const f = q.toLowerCase();
  const list: PlexItem[] = q
    ? (library ?? []).filter((i) => i.title.toLowerCase().includes(f) || i.parentTitle?.toLowerCase().includes(f)).slice(0, 60)
    : shelf.map((s) => s.item as PlexItem);

  return (
    <div className="r-browse">
      <Search value={q} onChange={setQ} placeholder={kind === 'dvd' ? 'Search all movies & shows…' : 'Search all albums…'} />
      {!q && <h3 className="r-h">On the shelf</h3>}
      {q && !library && <p className="r-note">Opening the cabinet…</p>}
      <div className={`r-grid ${kind}`}>
        {list.map((i) => (
          <div key={itemId(i)} className="pin-wrap">
            <button className="r-tile" onClick={() => pick(i)}>
              <Cover src={plex.thumbUrl(plex.artFor(i), 200, kind === 'dvd' ? 300 : 200)} title={i.title} subtitle={kind === 'cd' ? i.parentTitle : undefined} />
              <span>{kind === 'cd' && i.parentTitle ? `${i.parentTitle} — ${i.title}` : i.title}</span>
            </button>
            {(i.type === 'movie' || i.type === 'show' || i.type === 'album') && <PinButton kind={kind} item={i} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function GameBrowser({ systems }: { systems: Status['systems'] }) {
  const shelf = useDisplay('game', false, 40);
  const [q, setQ] = useState('');
  const library = useLibrary(() => fetch('/api/roms').then((r) => r.json() as Promise<Rom[]>), q.length > 0);
  const f = q.toLowerCase();
  const list: Rom[] = q ? (library ?? []).filter((r) => r.name.toLowerCase().includes(f)).slice(0, 80) : shelf.map((s) => s.item as Rom);
  return (
    <div className="r-browse">
      <Search value={q} onChange={setQ} placeholder="Search all games…" />
      {!q && <h3 className="r-h">On the shelf</h3>}
      {list.length === 0 && <p className="r-note">No games yet. Put ROMs in the rack's ROMS_DIR.</p>}
      <div className="r-carts">
        {list.map((r) => (
          <div key={r.id} className="pin-wrap">
            <button className={`r-cart sys-${r.system}`} onClick={() => send({ type: 'loadCart', rom: r })}>
              <small>{systems.find((s) => s.id === r.system)?.short}</small>
              <span>{r.name}</span>
            </button>
            <PinButton kind={'game' as ShelfKind} item={r} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TunerBrowser({ state }: { state: RackState }) {
  if (!state.spotify) return <p className="r-note">Connect Spotify on the rack first (TUNER input, then "Connect Spotify").</p>;
  return (
    <ul className="r-list">
      {state.presets.map((p, i) => (
        <li key={p.uri}>
          <button className={p.uri === state.tunerUri ? 'on' : ''} onClick={() => send({ type: 'tune', uri: p.uri })}>
            <Cover src={p.image} title={p.name} className="r-list-art" />
            <span>
              <b>{p.name}</b>
              <small>{p.owner}</small>
            </span>
            {i < 8 && p.kind === 'playlist' && <em>P{i + 1}</em>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function VcrBrowser({ state }: { state: RackState }) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const insert = () => {
    const parsed = yt.parse(link);
    if (!parsed) return setErr("That doesn't look like a YouTube link.");
    send({ type: 'loadTape', tape: { ...parsed, title: `Tape ${state.tapes.length + 1}`, added: Date.now() } });
    setLink('');
    setErr('');
  };
  return (
    <div className="r-browse">
      <form
        className="r-row"
        onSubmit={(e) => {
          e.preventDefault();
          insert();
        }}
      >
        <input className="r-search" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link…" />
        <button className="r-go" disabled={!link.trim()}>
          ▶
        </button>
      </form>
      <p className="r-note">Tip: share a video from the YouTube app, copy the link, paste it here.</p>
      {err && <p className="r-err">{err}</p>}
      <ul className="r-list">
        {state.tapes.map((t) => (
          <li key={t.id}>
            <button onClick={() => send({ type: 'loadTape', tape: t })}>
              <span className="r-vhs" style={{ backgroundImage: yt.thumb(t) ? `url(${yt.thumb(t)})` : undefined }} />
              <span>
                <b className="hand">{t.title}</b>
                <small>{t.channel}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── The remote ─────────────────────────────────────────────────────────

function Remote() {
  const { state, connected, online } = useRack();
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<Input | null>(null);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    loadShelves();
  }, []);

  const s = state;
  const input = s?.input ?? 'dvd';
  const browse = tab ?? input;
  const np = s?.now;
  const inputInfo = INPUTS.find((i) => i.id === input)!;
  const pct = np && np.duration ? Math.min(100, (np.position / np.duration) * 100) : 0;
  const plexOn = Boolean(status?.plex);

  const browser = useMemo(() => {
    if (!s) return null;
    if (browse === 'dvd' || browse === 'cd') return <PlexBrowser key={browse} kind={browse} plexOn={plexOn} />;
    if (browse === 'game') return <GameBrowser systems={status?.systems ?? []} />;
    if (browse === 'tuner') return <TunerBrowser state={s} />;
    return <VcrBrowser state={s} />;
  }, [browse, s, plexOn, status]);

  return (
    <div className="remote">
      <header className="r-top">
        <span className={`r-led ${connected ? 'on' : online ? 'warn' : ''}`} />
        <span className="r-brand">
          90RACK <small>RC-90 SYSTEM REMOTE</small>
        </span>
        <Key className="power" label="POWER" lit={s?.power} onPress={() => send({ type: 'power' })}>
          ⏻
        </Key>
      </header>

      {!connected && <div className="r-banner">{online ? 'Rack is off-line. Open the rack page on the TV.' : 'Looking for the rack…'}</div>}
      {s?.soundBlocked && <div className="r-banner warn">The rack needs one click on the TV before it can play sound.</div>}

      <section className="r-display">
        <div className="r-vfd">
          <span className="big">{s?.power ? inputInfo.label : 'STANDBY'}</span>
          <span>{s?.muted ? 'MUTING' : s ? `${s.volumeDb} dB` : ''}</span>
          <span className="dim">{s?.dsp}</span>
        </div>
        <div className="r-now">
          {np ? <Cover src={np.art} title={np.title} className="r-now-art" /> : <div className="r-now-art empty" />}
          <div className="r-now-text">
            <b>{np?.title ?? 'Nothing playing'}</b>
            <span>{np?.subtitle ?? inputInfo.source}</span>
            {np && np.duration > 0 && (
              <div className="r-bar">
                <i style={{ width: `${pct}%` }} />
                <small>
                  {fmtTime(np.position)} / {fmtTime(np.duration)}
                </small>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="r-inputs">
        {INPUTS.map((i) => (
          <Key key={i.id} className="pill" lit={s?.power && input === i.id} label={i.label} onPress={() => (send({ type: 'input', input: i.id }), setTab(null))}>
            <i />
          </Key>
        ))}
      </section>

      <section className="r-pad">
        <div className="r-vol">
          <Key className="rock up" repeat label="VOL" onPress={() => send({ type: 'volume', delta: 2 })}>
            +
          </Key>
          <Key className="rock down" repeat onPress={() => send({ type: 'volume', delta: -2 })}>
            −
          </Key>
        </div>
        <div className="r-transport">
          <Key className="t" label="PREV" onPress={() => send({ type: 'prev' })}>
            <Glyph name="prev" />
          </Key>
          <Key className="t big" label="PLAY/PAUSE" lit={np?.playing} onPress={() => send({ type: 'toggle' })}>
            <Glyph name="playpause" />
          </Key>
          <Key className="t" label="NEXT" onPress={() => send({ type: 'next' })}>
            <Glyph name="next" />
          </Key>
          <Key className="t" repeat label="REW" onPress={() => send({ type: 'seek', seconds: -10 })}>
            <Glyph name="rew" />
          </Key>
          <Key className="t" label="STOP" onPress={() => send({ type: 'stop' })}>
            <Glyph name="stop" />
          </Key>
          <Key className="t" repeat label="FF" onPress={() => send({ type: 'seek', seconds: 10 })}>
            <Glyph name="ff" />
          </Key>
        </div>
        <div className="r-side">
          <Key className="small" label="MUTE" lit={s?.muted} onPress={() => send({ type: 'mute' })}>
            <svg viewBox="0 0 20 20" className="glyph" aria-hidden>
              <path d="M2 7h4l5-4v14l-5-4H2zM13 7l5 6M18 7l-5 6" stroke="currentColor" strokeWidth="1.6" fill="currentColor" />
            </svg>
          </Key>
          <Key className="small" label="EJECT" onPress={() => send({ type: 'eject' })}>
            <Glyph name="eject" />
          </Key>
        </div>
      </section>

      <section className="r-func">
        <Key className="func" label="THEATER" lit={s?.theater} onPress={() => send({ type: 'theater' })}>
          <i />
        </Key>
        <Key className="func" label="CRT" lit={s?.crt} onPress={() => send({ type: 'crt' })}>
          <i />
        </Key>
        <Key className="func" label="DSP" onPress={() => send({ type: 'dsp' })}>
          <i />
        </Key>
        <Key className="func" label="CABINET" lit={s?.shelfOpen} onPress={() => send({ type: 'shelf' })}>
          <i />
        </Key>
        {input === 'cd' && (
          <Key className="func" label={s?.cdMode === 'normal' ? 'MODE' : s?.cdMode.toUpperCase()} lit={s?.cdMode !== 'normal'} onPress={() => send({ type: 'cdMode' })}>
            <i />
          </Key>
        )}
      </section>

      {input === 'cd' && s && s.cdSlots.some(Boolean) && (
        <section className="r-discs">
          {s.cdSlots.map((d, i) => (
            <button key={i} className={i === s.cdSlot ? 'on' : ''} disabled={!d} onClick={() => send({ type: 'cdSlot', slot: i })}>
              <b>DISC {i + 1}</b>
              <small>{d ? d.title : 'empty'}</small>
            </button>
          ))}
        </section>
      )}

      <nav className="r-tabs">
        {INPUTS.map((i) => (
          <button key={i.id} className={browse === i.id ? 'on' : ''} onClick={() => setTab(i.id)}>
            {i.id === 'dvd' ? 'Movies' : i.id === 'cd' ? 'Music' : i.id === 'tuner' ? 'Spotify' : i.id === 'vcr' ? 'Tapes' : 'Games'}
          </button>
        ))}
      </nav>
      <section className="r-shelf">{browser}</section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Remote />
  </StrictMode>,
);
