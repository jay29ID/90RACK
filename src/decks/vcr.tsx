import { useEffect, useRef, useState } from 'react';
import { Btn, Glyph, Led, Unit, Vfd } from '../components/ui';
import { useClock, useFlash, useInterval } from '../hooks';
import * as yt from '../sources/youtube';
import type { Tape, YTPlayer } from '../sources/youtube';
import { fmtTime, getState, outputGain, patchNow, registerTransport, setNow, setState, transport, useStore } from '../store';

// The shelf and the REC button both edit the tape collection.
let tapes = yt.loadTapes();
const tapeListeners = new Set<(t: Tape[]) => void>();

function setTapes(next: Tape[]) {
  tapes = next;
  yt.saveTapes(next);
  tapeListeners.forEach((l) => l(next));
}

function useTapes() {
  const [t, setT] = useState(tapes);
  useEffect(() => {
    tapeListeners.add(setT);
    return () => void tapeListeners.delete(setT);
  }, []);
  return t;
}

export function recordTape(t: Tape) {
  if (tapes.some((x) => x.id === t.id)) return;
  setTapes([{ ...t, added: Date.now(), color: Math.floor(Math.random() * 6) }, ...tapes]);
}

export function loadTape(t: Tape) {
  setState({ tape: t, input: 'vcr', shelfOpen: false });
}

// ── Screen ─────────────────────────────────────────────────────────────

export function VcrScreen({ visible }: { visible: boolean }) {
  const tape = useStore((s) => s.tape);
  const np = useStore((s) => s.now.vcr);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [tracking, setTracking] = useState(false);
  const osd = useFlash(np?.playing, 3000);

  useEffect(() => {
    if (!tape) {
      setNow('vcr', null);
      return;
    }
    setTracking(true);
    const trackingTimer = setTimeout(() => setTracking(false), 1100);
    setNow('vcr', { title: tape.title, subtitle: tape.channel, art: yt.thumb(tape), position: 0, duration: 0, playing: false });

    let player: YTPlayer | null = null;
    let cancelled = false;
    const mount = document.createElement('div');
    hostRef.current!.appendChild(mount);

    yt.loadApi().then(() => {
      if (cancelled) return;
      player = new window.YT!.Player(mount, {
        width: '100%',
        height: '100%',
        videoId: tape.kind === 'video' ? tape.id : undefined,
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          iv_load_policy: 3,
          ...(tape.kind === 'playlist' ? { listType: 'playlist', list: tape.id } : {}),
        },
        events: {
          onReady: () => {
            player!.setVolume(outputGain() * 100);
            player!.playVideo();
            playerRef.current = player;
          },
          onStateChange: (e: { data: number }) => {
            const S = window.YT!.PlayerState;
            const d = player!.getVideoData?.();
            patchNow('vcr', {
              playing: e.data === S.PLAYING,
              duration: player!.getDuration?.() || 0,
              ...(d?.title ? { title: d.title, subtitle: d.author } : {}),
            });
            // Tapes added by link get their real label once YouTube tells us.
            if (d?.title && tape.title !== d.title && tape.kind === 'video') {
              const i = tapes.findIndex((t) => t.id === tape.id);
              if (i >= 0 && tapes[i].title.startsWith('Tape ')) {
                const next = tapes.slice();
                next[i] = { ...next[i], title: d.title, channel: d.author };
                setTapes(next);
              }
            }
            if (e.data === S.ENDED && tape.kind === 'video') setState({ tape: null });
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(trackingTimer);
      player?.destroy?.();
      playerRef.current = null;
      mount.remove();
    };
  }, [tape]);

  useInterval(() => {
    const p = playerRef.current;
    if (p?.getCurrentTime) patchNow('vcr', { position: p.getCurrentTime(), duration: p.getDuration() });
  }, 500, Boolean(np?.playing));

  const gain = useStore((s) => outputGain(s));
  useEffect(() => playerRef.current?.setVolume(gain * 100), [gain]);

  useEffect(() => {
    const p = () => playerRef.current;
    return registerTransport('vcr', {
      toggle: () => (getState().now.vcr?.playing ? p()?.pauseVideo() : p()?.playVideo()),
      pause: () => p()?.pauseVideo(),
      stop: () => p()?.pauseVideo(),
      next: () => p()?.nextVideo(),
      prev: () => p()?.previousVideo(),
      seek: (d) => p()?.seekTo(Math.max(0, (p()?.getCurrentTime() ?? 0) + d), true),
      eject: () => setState({ tape: null }),
    });
  }, []);

  return (
    <div className={`screen screen-vcr ${visible ? 'is-visible' : ''}`}>
      <div ref={hostRef} className="yt-host" />
      {!tape && (
        <div className="vcr-blue">
          <div className="vcr-osd-top">
            <span>VIDEO 1</span>
          </div>
          <div className="vcr-insert">INSERT TAPE</div>
          <div className="vcr-osd-bottom">CH 03 · STEREO</div>
        </div>
      )}
      {tape && (osd || (np && !np.playing)) && (
        <div className="osd osd-vcr">
          {np?.playing ? '▶ PLAY' : '❚❚ PAUSE'}
          <span className="osd-time">{fmtTime(np?.position ?? 0)}</span>
        </div>
      )}
      {tracking && <div className="vcr-tracking" />}
    </div>
  );
}

// ── Faceplate ──────────────────────────────────────────────────────────

export function Vcr() {
  const active = useStore((s) => s.input === 'vcr');
  const tape = useStore((s) => s.tape);
  const np = useStore((s) => s.now.vcr);
  const power = useStore((s) => s.power);
  const clock = useClock();
  const saved = useTapes().some((t) => t.id === tape?.id);
  const t = () => transport('vcr');

  return (
    <Unit id="unit-vcr" model="SLV-HF90" name="Hi-Fi Stereo Video Cassette Recorder" active={active} u={3} finish="silver">
      <div className="vcr-face">
        <div className={`cassette-door ${tape ? 'loaded' : ''}`}>
          <span>VHS</span>
          {tape && <i className="tape-in" />}
        </div>
        <div className="vcr-mid">
          <Vfd className="vcr-vfd" color="green">
            {power &&
              (tape ? (
                <>
                  <span className="vfd-tag">{np?.playing ? '▶' : '❚❚'}</span>
                  <span className="vfd-big">{fmtTime(np?.position ?? 0)}</span>
                  <span className="vfd-tag">HI-FI</span>
                  <span className="vfd-tag">SP</span>
                </>
              ) : (
                <span className="vfd-big blink-1200">12:00</span>
              ))}
            {!power && <span className="vfd-big dim">{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          </Vfd>
          <div className="transport">
            <Btn title="Rewind" label="REW" onClick={() => t()?.seek?.(-10)}>
              <Glyph name="rew" />
            </Btn>
            <Btn title="Play/Pause" label="PLAY" lit={np?.playing} onClick={() => (tape ? t()?.toggle() : setState({ input: 'vcr', shelfOpen: true }))}>
              <Glyph name="play" />
            </Btn>
            <Btn title="Fast forward" label="FF" onClick={() => t()?.seek?.(10)}>
              <Glyph name="ff" />
            </Btn>
            <Btn title="Stop" label="STOP" onClick={() => t()?.stop()}>
              <Glyph name="stop" />
            </Btn>
            <Btn title="Save this tape to the shelf" label="REC" lit={saved} onClick={() => tape && recordTape(tape)} className="rec">
              <Glyph name="rec" />
            </Btn>
            <Btn title="Eject" label="EJECT" onClick={() => t()?.eject?.()}>
              <Glyph name="eject" />
            </Btn>
          </div>
        </div>
        <div className="vcr-right">
          <Led on={power} color="red" label="TIMER" />
          <Led on={power && Boolean(np?.playing)} color="green" label="HI-FI" />
          <span className="badge">4 HEAD</span>
        </div>
      </div>
    </Unit>
  );
}

// ── Shelf ──────────────────────────────────────────────────────────────

const LABEL_COLORS = ['#f6f1e1', '#ffe27a', '#ffb5a7', '#b8e0ff', '#c9f7c1', '#e6ccff'];

function VhsTape({ t, onPlay, onRecord, onErase, saved }: { t: Tape; onPlay: () => void; onRecord?: () => void; onErase?: () => void; saved?: boolean }) {
  return (
    <div className="vhs">
      <button className="vhs-body" onClick={onPlay} title={t.title}>
        <span className="vhs-thumb" style={{ backgroundImage: yt.thumb(t) ? `url(${yt.thumb(t)})` : undefined }} />
        <span className="vhs-label" style={{ background: LABEL_COLORS[(t.color ?? 0) % LABEL_COLORS.length] }}>
          <span className="vhs-title">{t.title}</span>
          {t.channel && <span className="vhs-channel">{t.channel}</span>}
        </span>
        <span className="vhs-brand">T-120 · SP</span>
      </button>
      {onRecord && (
        <button className="vhs-action" onClick={onRecord} disabled={saved} title="Save to shelf">
          {saved ? 'ON SHELF' : '● REC'}
        </button>
      )}
      {onErase && (
        <button className="vhs-action erase" onClick={onErase} title="Remove from shelf">
          ERASE
        </button>
      )}
    </div>
  );
}

export function VcrShelf() {
  const key = useStore((s) => s.status?.youtubeApiKey);
  const shelf = useTapes();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Tape[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = yt.parse(q);
    if (parsed) {
      const t: Tape = { ...parsed, title: `Tape ${shelf.length + 1}`, added: Date.now() };
      recordTape(t);
      loadTape(t);
      setQ('');
      return;
    }
    if (!key) return setError('Paste a YouTube link (add YOUTUBE_API_KEY to .env to enable search).');
    setBusy(true);
    try {
      setResults(await yt.search(q, key));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shelf shelf-vcr">
      <header className="shelf-head">
        <h2>Tape Shelf</h2>
      </header>
      <form
        className="shelf-search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input placeholder={key ? 'Search YouTube or paste a link…' : 'Paste a YouTube link…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" disabled={!q.trim() || busy}>
          {busy ? '…' : key ? 'Search' : 'Load'}
        </button>
      </form>
      {error && <p className="shelf-error">{error}</p>}

      {results && (
        <div className="row">
          <h3>
            Rental store <button className="link" onClick={() => setResults(null)}>clear</button>
          </h3>
          <div className="vhs-grid">
            {results.map((t) => (
              <VhsTape key={t.id} t={t} onPlay={() => loadTape(t)} onRecord={() => recordTape(t)} saved={shelf.some((s) => s.id === t.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="row">
        <h3>Your tapes</h3>
        {shelf.length === 0 && <p className="shelf-note">No tapes yet. Paste a link above, or hit REC on the deck while something plays.</p>}
        <div className="vhs-grid">
          {shelf.map((t) => (
            <VhsTape key={t.id} t={t} onPlay={() => loadTape(t)} onErase={() => setTapes(tapes.filter((x) => x.id !== t.id))} />
          ))}
        </div>
      </div>
    </div>
  );
}
