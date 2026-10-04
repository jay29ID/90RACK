import { useEffect, useRef, useState } from 'react';
import { Spectrum } from '../components/Spectrum';
import { Btn, Cover, Led, Unit, Vfd } from '../components/ui';
import { useInterval } from '../hooks';
import * as sp from '../sources/spotify';
import type { SpPlayer, SpPreset, SpTrackState } from '../sources/spotify';
import { fmtTime, getState, outputGain, patchNow, registerTransport, setNow, setState, transport, useStore } from '../store';

// Shared between the screen (which owns the SDK player) and the shelf/faceplate.
let deviceId: string | null = null;
let presetsCache: SpPreset[] = [];
const presetListeners = new Set<(p: SpPreset[]) => void>();

function setPresets(p: SpPreset[]) {
  presetsCache = p;
  presetListeners.forEach((l) => l(p));
}

function usePresets() {
  const [p, setP] = useState(presetsCache);
  useEffect(() => {
    presetListeners.add(setP);
    return () => void presetListeners.delete(setP);
  }, []);
  return p;
}

export async function tune(preset: SpPreset) {
  setState({ tunerUri: preset.uri, input: 'tuner', shelfOpen: false });
  if (deviceId) await sp.playContext(deviceId, preset.uri).catch((e) => console.warn(e));
}

/** Presets 1–8 sit on an FM band; each gets a made-up but stable frequency. */
const freqFor = (i: number) => (88.1 + i * 2.6).toFixed(1);

// ── Screen ─────────────────────────────────────────────────────────────

export function TunerScreen({ visible }: { visible: boolean }) {
  const clientId = useStore((s) => s.status?.spotifyClientId);
  const np = useStore((s) => s.now.tuner);
  const [loggedIn, setLoggedIn] = useState(sp.isLoggedIn());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<SpPlayer | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let player: SpPlayer | null = null;
    let cancelled = false;
    sp.playlists()
      .then(async (pl) => setPresets([...pl, ...(await sp.savedAlbums().catch(() => []))]))
      .catch((e) => setError(e.message));

    sp.loadSdk().then(() => {
      if (cancelled || !window.Spotify) return;
      player = new window.Spotify.Player({
        name: '90RACK Tuner',
        getOAuthToken: (cb: (t: string) => void) => sp.token().then(cb),
        volume: outputGain(),
      });
      playerRef.current = player;
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        deviceId = device_id;
        setReady(true);
      });
      player.addListener('not_ready', () => setReady(false));
      player.addListener('initialization_error', ({ message }: { message: string }) => setError(message));
      player.addListener('authentication_error', ({ message }: { message: string }) => {
        setError('Spotify login expired: ' + message);
        sp.logout();
        setLoggedIn(false);
      });
      player.addListener('account_error', () => setError('Spotify Premium is required for in-browser playback.'));
      player.addListener('playback_error', ({ message }: { message: string }) => setError(message));
      player.addListener('player_state_changed', (st: SpTrackState | null) => {
        if (!st) return setNow('tuner', null);
        const t = st.track_window.current_track;
        setNow('tuner', {
          title: t.name,
          subtitle: `${t.artists.map((a) => a.name).join(', ')} — ${t.album.name}`,
          art: t.album.images[0]?.url,
          position: st.position / 1000,
          duration: st.duration / 1000,
          playing: !st.paused,
        });
      });
      player.connect();
    });

    return () => {
      cancelled = true;
      player?.disconnect();
      playerRef.current = null;
      deviceId = null;
    };
  }, [loggedIn]);

  const gain = useStore((s) => outputGain(s));
  useEffect(() => {
    playerRef.current?.setVolume(gain).catch(() => {});
  }, [gain, ready]);

  // SDK only reports position on state change; tick it locally between events.
  useInterval(() => {
    const cur = getState().now.tuner;
    if (cur) patchNow('tuner', { position: Math.min(cur.duration, cur.position + 0.5) });
  }, 500, Boolean(np?.playing));

  useEffect(() => {
    const p = () => playerRef.current;
    return registerTransport('tuner', {
      toggle: () => {
        p()?.activateElement?.();
        p()?.togglePlay();
      },
      pause: () => p()?.pause(),
      stop: () => p()?.pause(),
      next: () => p()?.nextTrack(),
      prev: () => p()?.previousTrack(),
      seek: (d) => p()?.seek(Math.max(0, ((getState().now.tuner?.position ?? 0) + d) * 1000)),
    });
  }, []);

  return (
    <div className={`screen screen-tuner ${visible ? 'is-visible' : ''}`}>
      {!clientId ? (
        <div className="screen-empty">
          <h2>TUNER · NO SIGNAL</h2>
          <p>
            Add <code>SPOTIFY_CLIENT_ID</code> to <code>.env</code> to tune in your Spotify. See the README for the 2-minute setup.
          </p>
        </div>
      ) : !loggedIn ? (
        <div className="screen-empty">
          <h2>TUNER</h2>
          <p>Connect your Spotify account (Premium) to turn this rack into a Spotify Connect speaker.</p>
          <button className="cta" onClick={() => sp.login(clientId)}>
            Connect Spotify
          </button>
        </div>
      ) : np ? (
        <div className="tuner-now">
          <div className="tuner-bg" style={{ backgroundImage: np.art ? `url(${np.art})` : undefined }} />
          <Cover src={np.art} title={np.title} className="tuner-art" />
          <div className="tuner-info">
            <div className="tuner-title">{np.title}</div>
            <div className="tuner-sub">{np.subtitle}</div>
            <div className="tuner-bar">
              <span>{fmtTime(np.position)}</span>
              <i>
                <b style={{ width: `${(np.position / (np.duration || 1)) * 100}%` }} />
              </i>
              <span>{fmtTime(np.duration)}</span>
            </div>
            <Spectrum bands={40} segments={14} className="tuner-spectrum" />
          </div>
        </div>
      ) : (
        <div className="screen-empty">
          <h2>{ready ? 'TUNED · STEREO' : 'SCANNING…'}</h2>
          <p>
            {ready
              ? 'Pick a station from the preset shelf, or choose "90RACK Tuner" from any Spotify app.'
              : 'Warming up the Spotify player…'}
          </p>
          {presetsCache[0] && ready && (
            <button className="cta" onClick={() => tune(presetsCache[0])}>
              Tune to {presetsCache[0].name}
            </button>
          )}
        </div>
      )}
      {error && <div className="screen-error">{error}</div>}
    </div>
  );
}

// ── Faceplate ──────────────────────────────────────────────────────────

export function Tuner() {
  const active = useStore((s) => s.input === 'tuner');
  const uri = useStore((s) => s.tunerUri);
  const np = useStore((s) => s.now.tuner);
  const power = useStore((s) => s.power);
  const presets = usePresets().slice(0, 8);
  const idx = presets.findIndex((p) => p.uri === uri);
  const station = presets[idx];
  const needle = idx >= 0 ? 6 + (idx / 7) * 88 : 50;

  return (
    <Unit id="unit-tuner" model="ST-S90ES" name="FM Stereo / Spotify Tuner" active={active} u={2} finish="black">
      <div className="tuner-face">
        <div className="dial">
          <div className="dial-scale">
            {[88, 92, 96, 100, 104, 108].map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          <div className="dial-ticks" />
          <i className="needle" style={{ left: `${needle}%` }} />
        </div>
        <Vfd className="tuner-vfd" color="amber">
          {power && (
            <>
              <span className="vfd-tag">FM</span>
              <span className="vfd-big">{idx >= 0 ? freqFor(idx) : '--.-'}</span>
              <span className="vfd-tag">MHz</span>
              <span className="vfd-scroll">{station?.name ?? (sp.isLoggedIn() ? 'NO PRESET' : 'NO SIGNAL')}</span>
            </>
          )}
        </Vfd>
        <div className="tuner-row">
        <div className="tuner-leds">
          <Led on={power && Boolean(np)} color="green" label="TUNED" />
          <Led on={power && Boolean(np?.playing)} color="red" label="STEREO" />
        </div>
        <div className="presets">
          {Array.from({ length: 8 }, (_, i) => (
            <Btn key={i} label={String(i + 1)} variant="square" lit={power && i === idx} title={presets[i]?.name ?? 'Empty preset'} onClick={() => presets[i] && tune(presets[i])} />
          ))}
        </div>
        <div className="transport">
          <Btn title="Previous" label="◂ TUNING" variant="wide" onClick={() => transport('tuner')?.prev?.()} />
          <Btn title="Play/Pause" label="MEMORY" variant="round" lit={np?.playing} onClick={() => transport('tuner')?.toggle()} />
          <Btn title="Next" label="TUNING ▸" variant="wide" onClick={() => transport('tuner')?.next?.()} />
        </div>
        </div>
      </div>
    </Unit>
  );
}

// ── Shelf ──────────────────────────────────────────────────────────────

export function TunerShelf() {
  const presets = usePresets();
  const uri = useStore((s) => s.tunerUri);
  const clientId = useStore((s) => s.status?.spotifyClientId);
  const [tab, setTab] = useState<'playlist' | 'album'>('playlist');
  const shown = presets.filter((p) => p.kind === tab);

  return (
    <div className="shelf shelf-tuner">
      <header className="shelf-head">
        <h2>Station Presets</h2>
        {sp.isLoggedIn() && (
          <button
            className="link"
            onClick={() => {
              sp.logout();
              location.reload();
            }}
          >
            Sign out
          </button>
        )}
      </header>
      {!sp.isLoggedIn() ? (
        <p className="shelf-note">{clientId ? 'Connect Spotify on the screen to load your playlists.' : 'Spotify is not configured.'}</p>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === 'playlist' ? 'on' : ''} onClick={() => setTab('playlist')}>
              Playlists
            </button>
            <button className={tab === 'album' ? 'on' : ''} onClick={() => setTab('album')}>
              Albums
            </button>
          </nav>
          <ul className="station-list">
            {shown.map((p, i) => (
              <li key={p.uri}>
                <button className={p.uri === uri ? 'on' : ''} onClick={() => tune(p)}>
                  <Cover src={p.image} title={p.name} className="station-art" />
                  <span className="station-text">
                    <b>{p.name}</b>
                    <small>{p.owner}</small>
                  </span>
                  {tab === 'playlist' && i < 8 && <span className="station-preset">P{i + 1}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
