// Plex client. Everything goes through the server's /plex proxy, which adds
// the token, so URLs built here are safe to hand straight to <img>/<video>.

export interface PlexSection {
  key: string;
  title: string;
  type: 'movie' | 'show' | 'artist' | string;
}

export interface PlexItem {
  ratingKey: string;
  key: string;
  type: string; // movie | show | season | episode | album | track
  title: string;
  parentTitle?: string;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
  addedAt?: number;
  year?: number;
  index?: number;
  parentIndex?: number;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  art?: string;
  summary?: string;
  duration?: number; // ms
  viewOffset?: number; // ms
  viewCount?: number;
  leafCount?: number;
  contentRating?: string;
  studio?: string;
  Media?: { Part?: { key: string; container?: string }[]; videoResolution?: string; audioChannels?: number }[];
  demo?: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch('/plex' + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Plex ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

type Container<K extends string, T> = { MediaContainer: { [k in K]?: T[] } & { size?: number } };

export async function sections(): Promise<PlexSection[]> {
  const r = await get<Container<'Directory', PlexSection>>('/library/sections');
  return r.MediaContainer.Directory ?? [];
}

export async function items(sectionKey: string, type: number): Promise<PlexItem[]> {
  const r = await get<Container<'Metadata', PlexItem>>(`/library/sections/${sectionKey}/all?type=${type}&sort=titleSort`);
  return r.MediaContainer.Metadata ?? [];
}

export async function query(path: string): Promise<PlexItem[]> {
  const r = await get<Container<'Metadata', PlexItem>>(path);
  return r.MediaContainer.Metadata ?? [];
}

export async function children(ratingKey: string): Promise<PlexItem[]> {
  const r = await get<Container<'Metadata', PlexItem>>(`/library/metadata/${ratingKey}/children`);
  return r.MediaContainer.Metadata ?? [];
}

export async function onDeck(): Promise<PlexItem[]> {
  const r = await get<Container<'Metadata', PlexItem>>('/library/onDeck');
  return r.MediaContainer.Metadata ?? [];
}

export function thumbUrl(thumb: string | undefined, w: number, h: number) {
  if (!thumb) return undefined;
  if (thumb.startsWith('demo:')) return thumb;
  const q = new URLSearchParams({ width: String(w), height: String(h), minSize: '1', upscale: '1', url: thumb });
  return `/plex/photo/:/transcode?${q}`;
}

export function artFor(item: PlexItem) {
  return item.thumb || item.parentThumb || item.grandparentThumb;
}

const SESSION = Math.random().toString(36).slice(2);

/** HLS stream that Plex transcodes / remuxes into something any browser plays. */
export function videoStreamUrl(item: PlexItem, offsetSec = 0) {
  const q = new URLSearchParams({
    path: `/library/metadata/${item.ratingKey}`,
    mediaIndex: '0',
    partIndex: '0',
    protocol: 'hls',
    fastSeek: '1',
    directPlay: '0',
    directStream: '1',
    directStreamAudio: '1',
    videoQuality: '100',
    maxVideoBitrate: '40000',
    videoResolution: '3840x2160',
    subtitles: 'auto',
    audioBoost: '100',
    location: 'lan',
    offset: String(Math.floor(offsetSec)),
    session: SESSION,
    'X-Plex-Session-Identifier': SESSION,
    'X-Plex-Client-Profile-Extra':
      'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
  });
  return `/plex/video/:/transcode/universal/start.m3u8?${q}`;
}

export function stopTranscode() {
  fetch(`/plex/video/:/transcode/universal/stop?session=${SESSION}`).catch(() => {});
}

export function audioStreamUrl(track: PlexItem) {
  const part = track.Media?.[0]?.Part?.[0];
  return part ? '/plex' + part.key : undefined;
}

/** Tells Plex where we are so "Continue Watching" and play counts stay right. */
export function timeline(item: PlexItem, state: 'playing' | 'paused' | 'stopped', timeMs: number) {
  if (item.demo) return;
  const q = new URLSearchParams({
    ratingKey: item.ratingKey,
    key: item.key || `/library/metadata/${item.ratingKey}`,
    state,
    time: String(Math.floor(timeMs)),
    duration: String(item.duration ?? 0),
  });
  fetch(`/plex/:/timeline?${q}`).catch(() => {});
}

export function scrobble(item: PlexItem) {
  if (item.demo) return;
  fetch(`/plex/:/scrobble?identifier=com.plexapp.plugins.library&key=${item.ratingKey}`).catch(() => {});
}

// ── Demo library ───────────────────────────────────────────────────────
// Shown when Plex isn't configured, so the rack is never an empty box.

const demo = (type: string, title: string, extra: Partial<PlexItem> = {}): PlexItem => ({
  ratingKey: 'demo-' + title,
  key: '',
  type,
  title,
  thumb: 'demo:' + title,
  demo: true,
  ...extra,
});

export const DEMO_MOVIES: PlexItem[] = [
  ['Neon Harbor', 1996, 'R'],
  ['The Long Rewind', 1994, 'PG-13'],
  ['Midnight Arcade', 1998, 'PG'],
  ['Static Season', 1993, 'R'],
  ['Velvet Freeway', 1997, 'PG-13'],
  ['Satellite Summer', 1995, 'PG'],
  ['Blockbuster Night', 1999, 'PG-13'],
  ['Laser Disc Lullaby', 1992, 'G'],
].map(([t, y, r]) => demo('movie', t as string, { year: y as number, contentRating: r as string, duration: 6_300_000 }));

export const DEMO_ALBUMS: PlexItem[] = [
  ['Analog Hearts', 'The Dial Tones'],
  ['Six Disc Shuffle', 'Changer'],
  ['Mini Disc Memories', 'Atrac'],
  ['Bass Boost', 'Mega Bass'],
  ['Track Seven', 'The Liner Notes'],
  ['Jewel Case', 'Cracked Hinge'],
  ['Hi-Fi Lo-Fi', 'Dolby B'],
  ['Repeat One', 'Shuffle Club'],
  ['Tape Hiss', 'Chrome Type II'],
  ['Wall of Sound', 'Bi-Amp'],
].map(([t, a]) => demo('album', t, { parentTitle: a, year: 1990 + (t.length % 10), leafCount: 10 + (t.length % 5) }));

export function demoTracks(album: PlexItem): PlexItem[] {
  const words = ['Intro', 'Rewind', 'Signal', 'Shuffle', 'Fade', 'Static', 'Groove', 'Encore', 'Hiss', 'Outro', 'B-Side', 'Hidden Track'];
  return Array.from({ length: album.leafCount ?? 10 }, (_, i) =>
    demo('track', words[i % words.length], {
      ratingKey: `${album.ratingKey}-${i}`,
      index: i + 1,
      parentTitle: album.title,
      grandparentTitle: album.parentTitle,
      thumb: album.thumb,
      duration: (150 + ((i * 37) % 120)) * 1000,
    }),
  );
}
