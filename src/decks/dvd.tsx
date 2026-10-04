import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { attachMedia, playFailed } from '../audio';
import { PinButton } from '../components/PinButton';
import { Btn, Cover, Glyph, Led, Unit, Vfd } from '../components/ui';
import { useDemoClock, useFlash } from '../hooks';
import { notePlayed } from '../shelves';
import * as plex from '../sources/plex';
import type { PlexItem, PlexSection } from '../sources/plex';
import { fmtTime, getState, patchNow, registerTransport, setNow, setState, transport, useStore } from '../store';

export function loadDvd(item: PlexItem) {
  notePlayed('dvd', item);
  setState({ dvd: item, input: 'dvd', shelfOpen: false });
}

function label(item: PlexItem) {
  if (item.type === 'episode') {
    return {
      title: item.grandparentTitle ?? item.title,
      subtitle: `S${item.parentIndex ?? 0}·E${item.index ?? 0}  ${item.title}`,
    };
  }
  return { title: item.title, subtitle: [item.year, item.contentRating].filter(Boolean).join(' · ') };
}

// ── Screen ─────────────────────────────────────────────────────────────

export function DvdScreen({ visible }: { visible: boolean }) {
  const disc = useStore((s) => s.dvd);
  const np = useStore((s) => s.now.dvd);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const osd = useFlash(np?.playing);

  useDemoClock('dvd', Boolean(disc?.demo), () => transport('dvd')?.stop());

  useEffect(() => {
    setError(null);
    if (!disc) {
      setNow('dvd', null);
      return;
    }
    const { title, subtitle } = label(disc);
    const art = plex.thumbUrl(plex.artFor(disc), 300, 450);
    const duration = (disc.duration ?? 0) / 1000;
    setNow('dvd', { title, subtitle, art, position: 0, duration, playing: true });

    if (disc.demo) {
      const off = registerTransport('dvd', {
        toggle: () => patchNow('dvd', { playing: !getState().now.dvd?.playing }),
        pause: () => patchNow('dvd', { playing: false }),
        stop: () => setState({ dvd: null }),
        eject: () => setState({ dvd: null }),
        seek: (d) => patchNow('dvd', { position: Math.max(0, (getState().now.dvd?.position ?? 0) + d) }),
      });
      return off;
    }

    const video = videoRef.current!;
    const src = plex.videoStreamUrl(disc);
    let hls: Hls | null = null;
    const resume = (disc.viewOffset ?? 0) / 1000;

    if (Hls.isSupported()) {
      hls = new Hls({ startPosition: resume, maxBufferLength: 60 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError(`Plex stream error: ${data.details}`);
      });
    } else {
      video.src = src;
      video.currentTime = resume;
    }
    attachMedia(video);
    video.play().catch((e) => {
      playFailed(e);
      patchNow('dvd', { playing: false });
    });

    let lastReport = 0;
    let scrobbled = false;
    const onTime = () => {
      patchNow('dvd', { position: video.currentTime, duration: video.duration || duration });
      const now = Date.now();
      if (now - lastReport > 10_000) {
        lastReport = now;
        plex.timeline(disc, video.paused ? 'paused' : 'playing', video.currentTime * 1000);
      }
      if (!scrobbled && duration && video.currentTime / duration > 0.92) {
        scrobbled = true;
        plex.scrobble(disc);
      }
    };
    const onPlay = () => patchNow('dvd', { playing: true });
    const onPause = () => {
      patchNow('dvd', { playing: false });
      plex.timeline(disc, 'paused', video.currentTime * 1000);
    };
    const onEnded = () => setState({ dvd: null });
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    const off = registerTransport('dvd', {
      toggle: () => (video.paused ? video.play().catch(playFailed) : video.pause()),
      pause: () => video.pause(),
      stop: () => setState({ dvd: null }),
      eject: () => setState({ dvd: null }),
      seek: (d) => (video.currentTime = Math.max(0, video.currentTime + d)),
    });

    return () => {
      off();
      plex.timeline(disc, 'stopped', video.currentTime * 1000);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
      plex.stopTranscode();
    };
  }, [disc]);

  return (
    <div className={`screen screen-dvd ${visible ? 'is-visible' : ''}`}>
      <video ref={videoRef} className="screen-video" playsInline onClick={() => transport('dvd')?.toggle()} hidden={!disc || disc.demo} />
      {!disc && <DvdScreensaver />}
      {disc?.demo && np && (
        <div className="demo-feature">
          <Cover src={np.art} title={np.title} className="demo-feature-cover" />
          <div>
            <div className="demo-feature-title">{np.title}</div>
            <div className="demo-feature-sub">DEMO DISC · add PLEX_URL and PLEX_TOKEN to .env to play your real library</div>
          </div>
        </div>
      )}
      {disc && (osd || (np && !np.playing)) && (
        <div className="osd osd-dvd">
          {np?.playing ? (
            <>
              <Glyph name="play" /> PLAY
            </>
          ) : (
            <>
              <Glyph name="pause" /> PAUSE
            </>
          )}
          <span className="osd-time">{fmtTime(np?.position ?? 0)}</span>
        </div>
      )}
      {error && <div className="screen-error">{error}</div>}
    </div>
  );
}

/** The bouncing logo. Everyone waited for it to hit the corner. */
function DvdScreensaver() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let x = 40,
      y = 30,
      dx = 1.6,
      dy = 1.2,
      hue = 200,
      raf = 0;
    const tick = () => {
      const el = ref.current;
      const parent = el?.parentElement;
      if (el && parent) {
        const maxX = parent.clientWidth - el.offsetWidth;
        const maxY = parent.clientHeight - el.offsetHeight;
        x += dx;
        y += dy;
        if (x <= 0 || x >= maxX) {
          dx = -dx;
          hue = (hue + 67) % 360;
        }
        if (y <= 0 || y >= maxY) {
          dy = -dy;
          hue = (hue + 67) % 360;
        }
        x = Math.max(0, Math.min(maxX, x));
        y = Math.max(0, Math.min(maxY, y));
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.color = `hsl(${hue} 90% 60%)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="dvd-saver">
      <div ref={ref} className="dvd-logo">
        <span>DVD</span>
        <small>VIDEO</small>
      </div>
    </div>
  );
}

// ── Faceplate ──────────────────────────────────────────────────────────

export function DvdPlayer() {
  const active = useStore((s) => s.input === 'dvd');
  const disc = useStore((s) => s.dvd);
  const np = useStore((s) => s.now.dvd);
  const power = useStore((s) => s.power);
  const t = () => transport('dvd');

  return (
    <Unit id="unit-dvd" model="DVP-S90" name="DVD / Video CD Player" active={active} u={2} finish="titanium">
      <div className="dvd-face">
        <div className={`tray ${disc ? 'loaded' : ''}`}>
          <span className="tray-logo">DVD</span>
        </div>
        <Vfd className="dvd-vfd">
          {!power ? null : disc ? (
            <>
              <span className="vfd-tag">{np?.playing ? '▶' : '❚❚'}</span>
              <span className="vfd-tag">TITLE 01</span>
              <span className="vfd-big">{fmtTime(np?.position ?? 0)}</span>
              <span className="vfd-scroll">{np?.title}</span>
            </>
          ) : (
            <span className="vfd-big">NO DISC</span>
          )}
        </Vfd>
        <div className="transport">
          <Btn title="Open/Close" onClick={() => t()?.eject?.()}>
            <Glyph name="eject" />
          </Btn>
          <Btn title="Rewind 30s" onClick={() => t()?.seek?.(-30)}>
            <Glyph name="rew" />
          </Btn>
          <Btn title="Play/Pause" onClick={() => (disc ? t()?.toggle() : setState({ input: 'dvd', shelfOpen: true }))} lit={np?.playing}>
            <Glyph name="playpause" />
          </Btn>
          <Btn title="Stop" onClick={() => t()?.stop()}>
            <Glyph name="stop" />
          </Btn>
          <Btn title="Forward 30s" onClick={() => t()?.seek?.(30)}>
            <Glyph name="ff" />
          </Btn>
        </div>
        <div className="badges">
          <span className="badge">DOLBY DIGITAL</span>
          <span className="badge">dts</span>
          <Led on={power && Boolean(np?.playing)} color="blue" label="PROG." />
        </div>
      </div>
    </Unit>
  );
}

// ── Shelf ──────────────────────────────────────────────────────────────

type View = { kind: 'section'; section: PlexSection } | { kind: 'show'; show: PlexItem } | { kind: 'season'; show: PlexItem; season: PlexItem };

export function DvdShelf() {
  const plexOn = useStore((s) => Boolean(s.status?.plex));
  const [sections, setSections] = useState<PlexSection[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [items, setItems] = useState<PlexItem[]>(plexOn ? [] : plex.DEMO_MOVIES);
  const [deck, setDeck] = useState<PlexItem[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!plexOn) return;
    plex
      .sections()
      .then((all) => {
        const video = all.filter((s) => s.type === 'movie' || s.type === 'show');
        setSections(video);
        if (video[0]) setView((v) => v ?? { kind: 'section', section: video[0] });
      })
      .catch((e) => setError(e.message));
    plex.onDeck().then(setDeck).catch(() => {});
  }, [plexOn]);

  // Clicking a box set on the wall opens the cabinet right at that show.
  const focus = useStore((s) => s.cabinetFocus);
  useEffect(() => {
    if (!focus) return;
    setView({ kind: 'show', show: focus });
    setState({ cabinetFocus: null });
  }, [focus]);

  useEffect(() => {
    if (!view) return;
    setLoading(true);
    setFilter('');
    const p =
      view.kind === 'section'
        ? plex.items(view.section.key, view.section.type === 'show' ? 2 : 1)
        : plex.children(view.kind === 'show' ? view.show.ratingKey : view.season.ratingKey);
    p.then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [view]);

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return f ? items.filter((i) => i.title.toLowerCase().includes(f)) : items;
  }, [items, filter]);

  const open = (item: PlexItem) => {
    if (item.type === 'show') setView({ kind: 'show', show: item });
    else if (item.type === 'season' && view?.kind === 'show') setView({ kind: 'season', show: view.show, season: item });
    else loadDvd(item);
  };

  const isEpisodes = view?.kind === 'season';

  return (
    <div className="shelf shelf-dvd">
      <header className="shelf-head">
        <h2>DVD Shelf</h2>
        {!plexOn && <span className="shelf-note">Demo discs — connect Plex in .env</span>}
      </header>

      {sections.length > 0 && (
        <nav className="tabs">
          {sections.map((s) => (
            <button
              key={s.key}
              className={view?.kind === 'section' && view.section.key === s.key ? 'on' : ''}
              onClick={() => setView({ kind: 'section', section: s })}
            >
              {s.title}
            </button>
          ))}
        </nav>
      )}

      {view && view.kind !== 'section' && (
        <div className="crumbs">
          <button onClick={() => setView(view.kind === 'season' ? { kind: 'show', show: view.show } : null)}>‹ Back</button>
          <span>{view.kind === 'show' ? view.show.title : `${view.show.title} · ${view.season.title}`}</span>
        </div>
      )}

      {plexOn && view?.kind === 'section' && deck.length > 0 && !filter && (
        <div className="row">
          <h3>Continue watching</h3>
          <div className="row-scroll">
            {deck.map((i) => (
              <button key={i.ratingKey} className="keepcase small" onClick={() => loadDvd(i)}>
                <Cover src={plex.thumbUrl(plex.artFor(i), 200, 300)} title={i.grandparentTitle ?? i.title} />
                {i.viewOffset && i.duration && <i className="progress" style={{ width: `${(i.viewOffset / i.duration) * 100}%` }} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length > 12 && <input className="shelf-filter" placeholder="Find a title…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {error && <p className="shelf-error">{error}</p>}
      {loading && <p className="shelf-note">Pulling cases off the shelf…</p>}

      {isEpisodes ? (
        <ol className="episodes">
          {shown.map((ep) => (
            <li key={ep.ratingKey}>
              <button onClick={() => loadDvd(ep)}>
                <span className="ep-num">{ep.index}</span>
                <span className="ep-title">{ep.title}</span>
                <span className="ep-dur">{fmtTime((ep.duration ?? 0) / 1000)}</span>
                {ep.viewCount ? <span className="ep-seen">✓</span> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="case-grid">
          {shown.map((i) => (
            <div key={i.ratingKey} className="pin-wrap">
              <button className="keepcase" onClick={() => open(i)} title={i.title}>
                <Cover src={plex.thumbUrl(plex.artFor(i), 240, 360)} title={i.title} subtitle={i.year ? String(i.year) : undefined} />
                <span className="case-title">{i.title}</span>
              </button>
              {(i.type === 'movie' || i.type === 'show') && <PinButton kind="dvd" item={i} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
