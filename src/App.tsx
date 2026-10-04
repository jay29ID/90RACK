import { useEffect } from 'react';
import { applySettings, unlockSound } from './audio';
import { MediaWall } from './components/MediaWall';
import { RemotePairing } from './components/RemotePairing';
import { CdChanger, CdScreen, CdShelf } from './decks/cd';
import { DvdPlayer, DvdScreen, DvdShelf } from './decks/dvd';
import { GameDeck, GameScreen, GameShelf } from './decks/game';
import { Tuner, TunerScreen, TunerShelf } from './decks/tuner';
import { Vcr, VcrScreen, VcrShelf } from './decks/vcr';
import { Equalizer, PowerConditioner, Receiver, powerToggle } from './rack';
import { INPUTS, getState, selectInput, setState, transport, useStore } from './store';

const SHELVES = { dvd: DvdShelf, cd: CdShelf, tuner: TunerShelf, vcr: VcrShelf, game: GameShelf };

function useRemote() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = getState();
      const k = e.key;

      if (!s.power) {
        if (k === 'p' || k === 'Enter' || k === ' ') {
          powerToggle();
          e.preventDefault();
        }
        return;
      }
      const t = transport();
      const n = Number(k);
      if (n >= 1 && n <= INPUTS.length) selectInput(INPUTS[n - 1].id);
      else if (k === ' ' || k === 'MediaPlayPause' || k === 'k') t?.toggle();
      else if (k === 'MediaStop') t?.stop();
      else if (k === 'MediaTrackNext' || k === '.' || k === 'n') t?.next ? t.next() : t?.seek?.(30);
      else if (k === 'MediaTrackPrevious' || k === ',') t?.prev ? t.prev() : t?.seek?.(-30);
      else if (k === 'l') t?.seek?.(10);
      else if (k === 'j') t?.seek?.(-10);
      else if (k === '+' || k === '=' || k === 'AudioVolumeUp') setState({ volume: Math.min(100, s.volume + 2), muted: false });
      else if (k === '-' || k === '_' || k === 'AudioVolumeDown') setState({ volume: Math.max(0, s.volume - 2) });
      else if (k === 'm' || k === 'AudioVolumeMute') setState({ muted: !s.muted });
      else if (k === 't') setState({ theater: !s.theater });
      else if (k === 'c') setState({ crt: !s.crt });
      else if (k === 'r') setState({ pairOpen: !s.pairOpen });
      else if (k === 's') setState({ shelfOpen: !s.shelfOpen });
      else if (k === 'e') t?.eject?.();
      else if (k === 'p') powerToggle();
      else if (k === 'f') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      } else if (k === 'Escape' && (s.theater || s.pairOpen)) setState({ theater: false, pairOpen: false });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Tv() {
  const input = useStore((s) => s.input);
  const power = useStore((s) => s.power);
  const booting = useStore((s) => s.booting);
  const crt = useStore((s) => s.crt);
  const soundBlocked = useStore((s) => s.soundBlocked);
  const inputInfo = INPUTS.find((i) => i.id === input)!;

  return (
    <div className="tv">
      <div className="tv-bezel">
        <div className={`tv-screen ${power ? 'on' : 'off'} ${booting ? 'booting' : ''} ${crt ? 'crt' : ''}`}>
          {/* Every deck stays mounted so music keeps playing while you browse. */}
          <DvdScreen visible={input === 'dvd'} />
          <CdScreen visible={input === 'cd'} />
          <TunerScreen visible={input === 'tuner'} />
          <VcrScreen visible={input === 'vcr'} />
          <GameScreen visible={input === 'game'} />
          <div className="tv-input-osd" key={input}>
            {inputInfo.label}
          </div>
          {!power && (
            <button className="standby-screen" onClick={powerToggle}>
              <span className="standby-led" />
              <span>Press POWER</span>
              <small>or hit Enter</small>
            </button>
          )}
          {power && soundBlocked && (
            <button className="sound-blocked" onClick={() => unlockSound().then(() => !getState().now[getState().input]?.playing && transport()?.toggle())}>
              <b>🔈 Click to start sound</b>
              <small>Your browser wants one click on the rack before it plays audio</small>
            </button>
          )}
          <div className="tv-glass" />
        </div>
        <div className="tv-chin">
          <span className="tv-brand">90RACK</span>
          <span className="tv-model">TRINITRON-ISH · 65"</span>
          <span className={`tv-led ${power ? 'on' : ''}`} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const input = useStore((s) => s.input);
  const power = useStore((s) => s.power);
  const theater = useStore((s) => s.theater);
  const lamp = useStore((s) => s.lamp);
  const shelfOpen = useStore((s) => s.shelfOpen);
  const volume = useStore((s) => s.volume);
  const muted = useStore((s) => s.muted);
  const eq = useStore((s) => s.eq);
  const dsp = useStore((s) => s.dsp);
  useRemote();

  useEffect(applySettings, [volume, muted, eq, dsp, power]);

  // Bring the selected component into view on small screens.
  useEffect(() => {
    document.getElementById(`unit-${input}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [input]);

  const Shelf = SHELVES[input];

  return (
    <div className={`room ${power ? 'powered' : 'standby'} ${theater ? 'theater' : ''} ${lamp ? 'lamp' : ''}`}>
      <div className="wall-unit">
        <aside className="rack-col">
          <div className="rack">
            <PowerConditioner />
            <Receiver />
            <Equalizer />
            <CdChanger />
            <DvdPlayer />
            <Tuner />
            <Vcr />
            <GameDeck />
          </div>
        </aside>

        <main className="tv-col">
          <Tv />
          {!theater && <MediaWall />}
        </main>

        <aside className={`shelf-col ${shelfOpen ? 'open' : 'closed'}`}>
          <button className="shelf-toggle" onClick={() => setState({ shelfOpen: !shelfOpen })} title="Toggle shelf (S)">
            {shelfOpen ? 'CLOSE ›' : '‹ MEDIA'}
          </button>
          {shelfOpen && <Shelf />}
        </aside>
      </div>

      <RemotePairing />
      <footer className="remote-hint">
        <kbd>1</kbd>–<kbd>5</kbd> inputs · <kbd>Space</kbd> play/pause · <kbd>,</kbd>
        <kbd>.</kbd> skip · <kbd>+</kbd>
        <kbd>−</kbd> volume · <kbd>M</kbd> mute · <kbd>T</kbd> theater · <kbd>F</kbd> fullscreen · <kbd>S</kbd> cabinet · <kbd>R</kbd> phone remote
      </footer>
    </div>
  );
}
