// The shelves under the TV. Media stands spine-out like it would on a real
// wall unit, with the newest favourite turned face-out at the front of each
// section. Click to play, hover for the cover, right-click to take a pinned
// item off the shelf. Everything else lives in the cabinet (the drawer).

import type { CSSProperties } from 'react';
import { loadCd } from '../decks/cd';
import { loadDvd } from '../decks/dvd';
import { loadCart } from '../decks/game';
import { loadTape, useTapes } from '../decks/vcr';
import { itemId, togglePin, useDisplay, type ShelfKind } from '../shelves';
import * as plex from '../sources/plex';
import type { PlexItem } from '../sources/plex';
import * as yt from '../sources/youtube';
import type { Tape } from '../sources/youtube';
import { setState, useStore, type Input, type Rom } from '../store';
import { Cover } from './ui';

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function openCabinet(input: Input, focus: PlexItem | null = null) {
  setState({ input, shelfOpen: true, cabinetFocus: focus });
}

function Peek({ art, title, sub }: { art?: string; title: string; sub?: string }) {
  return (
    <span className="peek" aria-hidden>
      <Cover src={art} title={title} className="peek-art" />
      <span className="peek-title">{title}</span>
      {sub && <span className="peek-sub">{sub}</span>}
    </span>
  );
}

function PlexSpine({ kind, item, pinned, faceOut, playing }: { kind: ShelfKind; item: PlexItem; pinned: boolean; faceOut: boolean; playing: boolean }) {
  const art = plex.thumbUrl(plex.artFor(item), kind === 'dvd' ? 240 : 240, kind === 'dvd' ? 360 : 240);
  const sub = kind === 'cd' ? item.parentTitle : [item.year, item.type === 'show' ? 'Box set' : null].filter(Boolean).join(' · ');
  const play = () => (kind === 'cd' ? loadCd(item) : item.type === 'show' ? openCabinet('dvd', item) : loadDvd(item));
  const demoBg = item.demo ? `hsl(${hue(item.title)} 55% 32%)` : undefined;
  return (
    <button
      className={`spine spine-${kind} ${item.type === 'show' ? 'boxset' : ''} ${faceOut ? 'face-out' : ''} ${playing ? 'playing' : ''}`}
      onClick={play}
      onContextMenu={(e) => {
        if (!pinned) return;
        e.preventDefault();
        togglePin(kind, item);
      }}
      title={pinned ? `${item.title} (right-click to take off the shelf)` : item.title}
      style={{ '--art': art && !item.demo ? `url("${art}")` : 'none', '--demo': demoBg } as CSSProperties}
    >
      {faceOut ? (
        <Cover src={art} title={item.title} subtitle={sub} className="face-art" />
      ) : (
        <>
          <span className="spine-logo">{kind === 'dvd' ? 'DVD' : 'CD'}</span>
          <span className="spine-text">
            {kind === 'cd' && item.parentTitle ? <b>{item.parentTitle}</b> : null}
            {item.title}
          </span>
        </>
      )}
      {pinned && <i className="sticker" />}
      <Peek art={art} title={item.title} sub={sub} />
    </button>
  );
}

function CartSpine({ rom, pinned, playing, systemShort }: { rom: Rom; pinned: boolean; playing: boolean; systemShort?: string }) {
  return (
    <button
      className={`spine spine-cart sys-${rom.system} ${playing ? 'playing' : ''}`}
      onClick={() => loadCart(rom)}
      onContextMenu={(e) => {
        if (!pinned) return;
        e.preventDefault();
        togglePin('game', rom);
      }}
      title={rom.name}
    >
      <span className="cart-face-sys">{systemShort}</span>
      <span className="cart-face-label">{rom.name}</span>
      {pinned && <i className="sticker" />}
    </button>
  );
}

const LABELS = ['#f6f1e1', '#ffe27a', '#ffb5a7', '#b8e0ff', '#c9f7c1', '#e6ccff'];

function TapeSpine({ tape, playing }: { tape: Tape; playing: boolean }) {
  return (
    <button className={`spine spine-vhs ${playing ? 'playing' : ''}`} onClick={() => loadTape(tape)} title={tape.title}>
      <span className="vhs-spine-label" style={{ background: LABELS[(tape.color ?? 0) % LABELS.length] }}>
        {tape.title}
      </span>
      <span className="spine-logo">VHS</span>
      <Peek art={yt.thumb(tape)} title={tape.title} sub={tape.channel} />
    </button>
  );
}

function Section(props: { label: string; input: Input; className?: string; children: React.ReactNode; empty?: string; count: number }) {
  return (
    <div className={`wall-section ${props.className ?? ''}`}>
      <div className="wall-items">
        {props.count === 0 && props.empty && <span className="wall-empty">{props.empty}</span>}
        {props.children}
      </div>
      <button className="bookend" onClick={() => openCabinet(props.input)} title={`Open the ${props.label} cabinet`}>
        <span>{props.label}</span>
        <small>CABINET ›</small>
      </button>
    </div>
  );
}

export function MediaWall() {
  const plexOn = useStore((s) => Boolean(s.status?.plex));
  const systems = useStore((s) => s.status?.systems);
  const dvd = useStore((s) => s.dvd);
  const cd = useStore((s) => s.cdSlots[s.cdSlot]);
  const cart = useStore((s) => s.cart);
  const tape = useStore((s) => s.tape);
  const movies = useDisplay('dvd', plexOn, 60);
  const albums = useDisplay('cd', plexOn, 80);
  const games = useDisplay('game', plexOn, 30);
  const tapes = useTapes();

  const playingDvd = dvd && (dvd.type === 'episode' ? dvd.grandparentRatingKey : dvd.ratingKey);

  return (
    <div className="media-wall">
      <div className="wall-board">
        <Section label="MOVIES & TV" input="dvd" className="sec-dvd" count={movies.length}>
          {movies.map(({ item, pinned }, i) => (
            <PlexSpine key={itemId(item)} kind="dvd" item={item as PlexItem} pinned={pinned} faceOut={i === 0} playing={playingDvd === itemId(item)} />
          ))}
        </Section>
        <Section label="TAPES" input="vcr" className="sec-vhs" count={tapes.length} empty="Hit REC on the VCR to keep a tape">
          {tapes.map((t) => (
            <TapeSpine key={t.id} tape={t} playing={tape?.id === t.id} />
          ))}
        </Section>
      </div>
      <div className="wall-board">
        <Section label="MUSIC" input="cd" className="sec-cd" count={albums.length}>
          {albums.map(({ item, pinned }, i) => (
            <PlexSpine key={itemId(item)} kind="cd" item={item as PlexItem} pinned={pinned} faceOut={i === 0} playing={cd?.ratingKey === itemId(item)} />
          ))}
        </Section>
        <Section label="GAMES" input="game" className="sec-game" count={games.length} empty="Add ROMs to ROMS_DIR">
          {games.map(({ item, pinned }) => {
            const rom = item as Rom;
            return <CartSpine key={rom.id} rom={rom} pinned={pinned} playing={cart?.id === rom.id} systemShort={systems?.find((s) => s.id === rom.system)?.short} />;
          })}
        </Section>
      </div>
    </div>
  );
}

