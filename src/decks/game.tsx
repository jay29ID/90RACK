import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Led, Unit, Vfd } from '../components/ui';
import { outputGain, registerTransport, setNow, setState, useStore, type GameSystem, type Rom } from '../store';

export function loadCart(rom: Rom) {
  setState({ cart: rom, input: 'game', shelfOpen: false, crt: true });
}

function systemOf(systems: GameSystem[] | undefined, id?: string) {
  return systems?.find((s) => s.id === id);
}

// ── Screen ─────────────────────────────────────────────────────────────

export function GameScreen({ visible }: { visible: boolean }) {
  const cart = useStore((s) => s.cart);
  const systems = useStore((s) => s.status?.systems);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sys = systemOf(systems, cart?.system);
  const [nonce, setNonce] = useState(0);

  const src = useMemo(() => {
    if (!cart || !sys) return null;
    const q = new URLSearchParams({ core: sys.core, rom: cart.url, name: cart.name, volume: String(outputGain()) });
    return `/emu.html?${q}`;
    // Volume is only an initial value here; live changes go via postMessage.
  }, [cart, sys, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (msg: object) => frameRef.current?.contentWindow?.postMessage(msg, location.origin);

  useEffect(() => {
    if (!cart) return setNow('game', null);
    setNow('game', { title: cart.name, subtitle: sys?.name, position: 0, duration: 0, playing: true });
  }, [cart, sys]);

  const gain = useStore((s) => outputGain(s));
  useEffect(() => post({ type: 'volume', value: gain }), [gain]);

  useEffect(
    () =>
      registerTransport('game', {
        toggle: () => post({ type: 'toggle' }),
        pause: () => post({ type: 'pause' }),
        stop: () => post({ type: 'pause' }),
        eject: () => setState({ cart: null }),
      }),
    [],
  );

  // Hand keyboard focus to the game so the controller works right away.
  useEffect(() => {
    if (visible && src) setTimeout(() => frameRef.current?.focus(), 300);
  }, [visible, src]);

  return (
    <div className={`screen screen-game ${visible ? 'is-visible' : ''}`}>
      {src ? (
        <iframe ref={frameRef} key={src} src={src} title="Game" className="game-frame" allow="gamepad; autoplay; fullscreen" />
      ) : (
        <div className="game-idle">
          <div className="game-logo">
            90RACK<span>ENTERTAINMENT SYSTEM</span>
          </div>
          <p className="press-start">INSERT CARTRIDGE</p>
          <small>Gamepads work automatically · keyboard: arrows, Z, X, Enter</small>
        </div>
      )}
      {/* RESET on the console reloads the cart; exported so the faceplate can use it */}
      <ResetBridge onReset={() => setNonce((n) => n + 1)} />
    </div>
  );
}

let resetHandler: (() => void) | null = null;
function ResetBridge({ onReset }: { onReset: () => void }) {
  useEffect(() => {
    resetHandler = onReset;
    return () => void (resetHandler = null);
  });
  return null;
}

// ── Faceplate ──────────────────────────────────────────────────────────

export function GameDeck() {
  const active = useStore((s) => s.input === 'game');
  const cart = useStore((s) => s.cart);
  const systems = useStore((s) => s.status?.systems);
  const power = useStore((s) => s.power);
  const sys = systemOf(systems, cart?.system);

  return (
    <Unit id="unit-game" model="GX-64" name="Multi-System Game Deck" active={active} u={2} finish="black" brand="90RACK">
      <div className="game-face">
        <div className={`cart-slot ${cart ? 'loaded' : ''}`}>
          {cart && (
            <div className="cart">
              <span className="cart-sys">{sys?.short}</span>
              <span className="cart-name">{cart.name}</span>
            </div>
          )}
        </div>
        <Vfd className="game-vfd" color="red">
          {power && <span className="vfd-scroll">{cart ? `${sys?.short ?? ''} · ${cart.name}` : 'NO CARTRIDGE'}</span>}
        </Vfd>
        <div className="game-buttons">
          <Led on={power && Boolean(cart)} color="red" label="POWER" />
          <Btn label="RESET" variant="wide" onClick={() => resetHandler?.()} title="Reset the game" />
          <Btn label="EJECT" variant="wide" onClick={() => setState({ cart: null })} title="Eject cartridge" />
        </div>
        <div className="ports">
          <span className="port">1</span>
          <span className="port">2</span>
        </div>
      </div>
    </Unit>
  );
}

// ── Shelf ──────────────────────────────────────────────────────────────

export function GameShelf() {
  const status = useStore((s) => s.status);
  const [roms, setRoms] = useState<Rom[]>([]);
  const [sys, setSys] = useState<string>('all');
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/roms')
      .then((r) => r.json())
      .then(setRoms)
      .catch(() => {});
  }, [status?.romCount]);

  const present = useMemo(() => {
    const ids = new Set(roms.map((r) => r.system));
    return (status?.systems ?? []).filter((s) => ids.has(s.id));
  }, [roms, status]);

  const shown = roms.filter((r) => (sys === 'all' || r.system === sys) && r.name.toLowerCase().includes(filter.toLowerCase()));

  const playFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const match = (status?.systems ?? []).find((s) => s.exts?.includes(ext));
    if (!match) return alert(`Don't know which console plays .${ext} files. Put it in ROMS_DIR/<system>/ instead.`);
    loadCart({ id: 'local:' + file.name, name: file.name.replace(/\.[^.]+$/, ''), system: match.id, url: URL.createObjectURL(file) });
  };

  return (
    <div
      className="shelf shelf-game"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) playFile(f);
      }}
    >
      <header className="shelf-head">
        <h2>Cartridge Drawer</h2>
        <button className="link" onClick={() => fileRef.current?.click()}>
          Open ROM…
        </button>
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && playFile(e.target.files[0])} />
      </header>
      {roms.length === 0 ? (
        <p className="shelf-note">
          No ROMs found. Drop a ROM file here, or put your collection in <code>ROMS_DIR</code> organised by system (e.g. <code>roms/snes/</code>) and refresh.
        </p>
      ) : (
        <>
          <nav className="tabs">
            <button className={sys === 'all' ? 'on' : ''} onClick={() => setSys('all')}>
              All
            </button>
            {present.map((s) => (
              <button key={s.id} className={sys === s.id ? 'on' : ''} onClick={() => setSys(s.id)}>
                {s.short}
              </button>
            ))}
          </nav>
          {roms.length > 12 && <input className="shelf-filter" placeholder="Find a game…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        </>
      )}
      <div className="cart-grid">
        {shown.map((r) => {
          const s = systemOf(status?.systems, r.system);
          return (
            <button key={r.id} className={`cart-tile sys-${r.system}`} onClick={() => loadCart(r)} title={r.name}>
              <span className="cart-tile-sys">{s?.short}</span>
              <span className="cart-tile-label">{r.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
