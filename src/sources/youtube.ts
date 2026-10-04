// YouTube for the VCR: the IFrame Player API for playback, an optional Data
// API key for search, and a shelf of "tapes" saved in localStorage.

import { loadJson, saveJson } from '../store';

export interface Tape {
  id: string; // video id, or playlist id when kind === 'playlist'
  kind: 'video' | 'playlist';
  title: string;
  channel?: string;
  thumb?: string;
  added: number;
  color?: number; // label hue so the shelf looks hand-made
}

const TAPES_KEY = '90rack:tapes';

export function loadTapes(): Tape[] {
  return loadJson<Tape[]>(TAPES_KEY, []);
}

export function saveTapes(tapes: Tape[]) {
  saveJson(TAPES_KEY, tapes);
}

export function thumb(t: Pick<Tape, 'id' | 'kind' | 'thumb'>) {
  return t.thumb || (t.kind === 'video' ? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg` : undefined);
}

/** Accepts watch/short/embed/youtu.be/playlist URLs or a bare 11-char id. */
export function parse(input: string): Pick<Tape, 'id' | 'kind'> | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s, kind: 'video' };
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    const v = u.searchParams.get('v');
    if (v) return { id: v, kind: 'video' };
    const list = u.searchParams.get('list');
    if (list) return { id: list, kind: 'playlist' };
    if (u.hostname.endsWith('youtu.be')) return { id: u.pathname.slice(1, 12), kind: 'video' };
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    if (m) return { id: m[1], kind: 'video' };
  } catch {
    /* not a URL */
  }
  return null;
}

export async function search(q: string, key: string): Promise<Tape[]> {
  const p = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '24', q, key, videoEmbeddable: 'true' });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`);
  if (!res.ok) throw new Error('YouTube search failed (' + res.status + ')');
  const data = (await res.json()) as {
    items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { high?: { url: string } } } }[];
  };
  const decode = (s: string) => new DOMParser().parseFromString(s, 'text/html').body.textContent || s;
  return data.items.map((i) => ({
    id: i.id.videoId,
    kind: 'video' as const,
    title: decode(i.snippet.title),
    channel: i.snippet.channelTitle,
    thumb: i.snippet.thumbnails.high?.url,
    added: Date.now(),
  }));
}

// ── IFrame API ─────────────────────────────────────────────────────────

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: object) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(s: number, allowAhead: boolean): void;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { title: string; author: string; video_id: string };
  loadVideoById(id: string): void;
  loadPlaylist(opts: { list: string; listType: 'playlist' }): void;
  nextVideo(): void;
  previousVideo(): void;
  destroy(): void;
}

let apiPromise: Promise<void> | null = null;

export function loadApi() {
  apiPromise ??= new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}
