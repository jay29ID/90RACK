import { useEffect, useMemo, useRef, useState } from 'react';
import { attachMedia } from '../audio';
import { Spectrum } from '../components/Spectrum';
import { Btn, Cover, Glyph, Led, Unit, Vfd } from '../components/ui';
import { useDemoClock } from '../hooks';
import * as plex from '../sources/plex';
import type { PlexItem } from '../sources/plex';
import { fmtTime, getState, patchNow, registerTransport, setNow, setState, transport, useStore } from '../store';

/** Put an album in the carousel (reusing its slot if it's already in) and play it. */
export function loadCd(album: PlexItem) {
  const { cdSlots, cdSlot } = getState();
  let slot = cdSlots.findIndex((a) => a?.ratingKey === album.ratingKey);
  if (slot < 0) slot = cdSlots.findIndex((a) => !a);
  if (slot < 0) slot = (cdSlot + 1) % cdSlots.length;
  const next = cdSlots.slice();
  next[slot] = album;
  setState({ cdSlots: next, cdSlot: slot, cdLoadId: Date.now(), input: 'cd', shelfOpen: false });
}

function selectSlot(slot: number) {
  if (!getState().cdSlots[slot]) return;
  setState({ cdSlot: slot, cdLoadId: Date.now(), input: 'cd' });
}

const albumArt = (a?: PlexItem | null, size = 600) => (a ? plex.thumbUrl(plex.artFor(a), size, size) : undefined);

// ── Screen ─────────────────────────────────────────────────────────────

export function CdScreen({ visible }: { visible: boolean }) {
  const album = useStore((s) => s.cdSlots[s.cdSlot]);
  const loadId = useStore((s) => s.cdLoadId);
  const np = useStore((s) => s.now.cd);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<PlexItem[]>([]);
  const [index, setIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the tracklist whenever the carousel turns to a different disc.
  useEffect(() => {
    setError(null);
    setTracks([]);
    setIndex(0);
    setAutoplay(loadId > 0);
    if (!album) return setNow('cd', null);
    if (album.demo) return setTracks(plex.demoTracks(album));
    plex
      .children(album.ratingKey)
      .then(setTracks)
      .catch((e) => setError(e.message));
  }, [album?.ratingKey, loadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = (dir: 1 | -1, auto = false) => {
    const { cdMode } = getState();
    if (!tracks.length) return;
    if (auto && cdMode === 'repeat') {
      if (album?.demo) patchNow('cd', { position: 0 });
      else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
      return;
    }
    setAutoplay(true);
    if (cdMode === 'shuffle') return setIndex(Math.floor(Math.random() * tracks.length));
    const next = index + dir;
    if (next >= tracks.length) {
      // End of disc: a real changer rolls on to the next loaded disc.
      const { cdSlots, cdSlot } = getState();
      for (let k = 1; k <= cdSlots.length; k++) {
        const s = (cdSlot + k) % cdSlots.length;
        if (cdSlots[s] && s !== cdSlot) return selectSlot(s);
      }
      setAutoplay(auto ? false : true);
      return setIndex(0);
    }
    setIndex(Math.max(0, next));
  };

  useDemoClock('cd', Boolean(album?.demo), () => advance(1, true));

  // Load the current track.
  useEffect(() => {
    const track = tracks[index];
    const audio = audioRef.current!;
    if (!track || !album) return;
    setNow('cd', {
      title: track.title,
      subtitle: `${track.grandparentTitle ?? album.parentTitle ?? ''} — ${album.title}`,
      art: albumArt(album),
      position: 0,
      duration: (track.duration ?? 0) / 1000,
      playing: autoplay,
      track: index + 1,
    });
    if (album.demo) return;
    const src = plex.audioStreamUrl(track);
    if (!src) return setError('This track has no playable media');
    audio.src = src;
    attachMedia(audio);
    if (autoplay) audio.play().catch(() => patchNow('cd', { playing: false }));
  }, [tracks, index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transport.
  useEffect(() => {
    const audio = audioRef.current!;
    const demo = Boolean(album?.demo);
    const play = () => {
      setAutoplay(true);
      if (demo) patchNow('cd', { playing: true });
      else audio.play();
    };
    const pause = () => (demo ? patchNow('cd', { playing: false }) : audio.pause());
    return registerTransport('cd', {
      toggle: () => (getState().now.cd?.playing ? pause() : play()),
      pause,
      stop: () => {
        pause();
        if (demo) patchNow('cd', { position: 0 });
        else audio.currentTime = 0;
        setAutoplay(false);
      },
      next: () => advance(1),
      prev: () => {
        const pos = getState().now.cd?.position ?? 0;
        if (pos > 3) {
          if (demo) patchNow('cd', { position: 0 });
          else audio.currentTime = 0;
        } else advance(-1);
      },
      seek: (d) => {
        if (demo) patchNow('cd', { position: Math.max(0, (getState().now.cd?.position ?? 0) + d) });
        else audio.currentTime = Math.max(0, audio.currentTime + d);
      },
      eject: () => {
        const slots = getState().cdSlots.slice();
        slots[getState().cdSlot] = null;
        setState({ cdSlots: slots });
      },
    });
  });

  const spin = Boolean(np?.playing);

  return (
    <div className={`screen screen-cd ${visible ? 'is-visible' : ''}`}>
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => patchNow('cd', { position: e.currentTarget.currentTime, duration: e.currentTarget.duration || np?.duration })}
        onPlay={() => patchNow('cd', { playing: true })}
        onPause={() => patchNow('cd', { playing: false })}
        onEnded={() => advance(1, true)}
        onError={() => album && !album.demo && setError('Could not play this track (format not supported by the browser?)')}
      />
      {!album ? (
        <div className="screen-empty">
          <div className="big-disc idle" />
          <h2>NO DISC</h2>
          <p>Pick an album from the CD tower to load the changer.</p>
        </div>
      ) : (
        <div className="cd-now">
          <div className="cd-art-stack">
            <Cover src={albumArt(album)} title={album.title} subtitle={album.parentTitle} className="cd-art" />
            <div className={`big-disc ${spin ? 'spin' : ''}`}>
              <Cover src={albumArt(album, 300)} title={album.title} className="big-disc-label" />
            </div>
          </div>
          <div className="cd-info">
            <div className="cd-artist">{album.parentTitle}</div>
            <div className="cd-album">
              {album.title} {album.year && <span>({album.year})</span>}
            </div>
            <ol className="tracklist">
              {tracks.map((t, i) => (
                <li key={t.ratingKey} className={i === index ? 'on' : ''}>
                  <button
                    onClick={() => {
                      setAutoplay(true);
                      if (i === index) transport('cd')?.toggle();
                      else setIndex(i);
                    }}
                  >
                    <span className="tn">{String(i + 1).padStart(2, '0')}</span>
                    <span className="tt">{t.title}</span>
                    <span className="td">{fmtTime((t.duration ?? 0) / 1000)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <Spectrum bands={32} className="cd-spectrum" live={!album.demo} />
          </div>
        </div>
      )}
      {error && <div className="screen-error">{error}</div>}
    </div>
  );
}

// ── Faceplate ──────────────────────────────────────────────────────────

export function CdChanger() {
  const active = useStore((s) => s.input === 'cd');
  const slots = useStore((s) => s.cdSlots);
  const slot = useStore((s) => s.cdSlot);
  const mode = useStore((s) => s.cdMode);
  const np = useStore((s) => s.now.cd);
  const power = useStore((s) => s.power);
  const t = () => transport('cd');

  return (
    <Unit id="unit-cd" model="CDP-C590" name="5 Disc Compact Disc Changer" active={active} u={2}>
      <div className="cd-face">
        <div className="carousel-window">
          <div className="carousel" style={{ transform: `rotate(${-slot * 72}deg)` }}>
            {slots.map((a, i) => (
              <div key={i} className={`carousel-slot ${a ? 'full' : ''}`} style={{ transform: `rotate(${i * 72}deg) translateY(-24px)` }}>
                {a && <Cover src={albumArt(a, 80)} title={a.title} className={`mini-disc ${np?.playing && i === slot ? 'spin' : ''}`} />}
              </div>
            ))}
          </div>
        </div>
        <div className="cd-center">
          <Vfd className="cd-vfd">
            {!power ? null : slots[slot] ? (
              <>
                <span className="vfd-tag">DISC {slot + 1}</span>
                <span className="vfd-tag">TRACK {String(np?.track ?? 1).padStart(2, '0')}</span>
                <span className="vfd-big">{fmtTime(np?.position ?? 0)}</span>
                {mode !== 'normal' && <span className="vfd-tag hot">{mode.toUpperCase()}</span>}
                <span className="vfd-scroll">{np?.title}</span>
              </>
            ) : (
              <span className="vfd-big">{slots.some(Boolean) ? 'SELECT DISC' : 'NO DISC'}</span>
            )}
          </Vfd>
          <div className="disc-buttons">
            {slots.map((a, i) => (
              <Btn key={i} label={`DISC ${i + 1}`} variant="square" lit={power && i === slot && Boolean(a)} onClick={() => selectSlot(i)} title={a ? a.title : 'Empty'}>
                <Led on={power && Boolean(a)} color={i === slot ? 'amber' : 'green'} />
              </Btn>
            ))}
          </div>
        </div>
        <div className="transport">
          <Btn title="Previous track" onClick={() => t()?.prev?.()}>
            <Glyph name="prev" />
          </Btn>
          <Btn title="Play/Pause" lit={np?.playing} onClick={() => (slots[slot] ? t()?.toggle() : setState({ input: 'cd', shelfOpen: true }))}>
            <Glyph name="playpause" />
          </Btn>
          <Btn title="Stop" onClick={() => t()?.stop()}>
            <Glyph name="stop" />
          </Btn>
          <Btn title="Next track" onClick={() => t()?.next?.()}>
            <Glyph name="next" />
          </Btn>
          <Btn
            title="Play mode"
            label={mode === 'normal' ? 'MODE' : mode.toUpperCase()}
            variant="round"
            lit={mode !== 'normal'}
            onClick={() => setState({ cdMode: mode === 'normal' ? 'shuffle' : mode === 'shuffle' ? 'repeat' : 'normal' })}
          />
          <Btn title="Eject disc" onClick={() => t()?.eject?.()}>
            <Glyph name="eject" />
          </Btn>
        </div>
      </div>
    </Unit>
  );
}

// ── Shelf (CD tower) ───────────────────────────────────────────────────

export function CdShelf() {
  const plexOn = useStore((s) => Boolean(s.status?.plex));
  const slots = useStore((s) => s.cdSlots);
  const [albums, setAlbums] = useState<PlexItem[]>(plexOn ? [] : plex.DEMO_ALBUMS);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!plexOn) return;
    setLoading(true);
    plex
      .sections()
      .then(async (all) => {
        const music = all.filter((s) => s.type === 'artist');
        const lists = await Promise.all(music.map((m) => plex.items(m.key, 9)));
        setAlbums(lists.flat().sort((a, b) => (a.parentTitle ?? '').localeCompare(b.parentTitle ?? '') || a.title.localeCompare(b.title)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [plexOn]);

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return f ? albums.filter((a) => a.title.toLowerCase().includes(f) || a.parentTitle?.toLowerCase().includes(f)) : albums;
  }, [albums, filter]);

  return (
    <div className="shelf shelf-cd">
      <header className="shelf-head">
        <h2>CD Tower</h2>
        {!plexOn && <span className="shelf-note">Demo discs — connect Plex in .env</span>}
      </header>
      <input className="shelf-filter" placeholder="Artist or album…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="shelf-error">{error}</p>}
      {loading && <p className="shelf-note">Flipping through the tower…</p>}
      <div className="jewel-grid">
        {shown.map((a) => {
          const inChanger = slots.some((s) => s?.ratingKey === a.ratingKey);
          return (
            <button key={a.ratingKey} className={`jewel ${inChanger ? 'in-changer' : ''}`} onClick={() => loadCd(a)} title={`${a.parentTitle} — ${a.title}`}>
              <Cover src={albumArt(a, 300)} title={a.title} subtitle={a.parentTitle} />
              <span className="jewel-text">
                <b>{a.parentTitle}</b>
                {a.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
