// Spotify: PKCE login (no secret needed) + the Web Playback SDK, which turns
// this browser tab into a Spotify Connect device called "90RACK Tuner".

import { loadJson, saveJson } from '../store';

const AUTH_KEY = '90rack:spotify';
const VERIFIER_KEY = '90rack:spotify-verifier';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

interface Auth {
  access: string;
  refresh: string;
  expires: number;
  clientId: string;
}

let auth: Auth | null = loadJson<Auth | null>(AUTH_KEY, null);

const redirectUri = () => location.origin + '/callback';

function b64url(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isLoggedIn() {
  return Boolean(auth?.refresh);
}

export async function login(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: clientId,
  });
  location.href = `https://accounts.spotify.com/authorize?${q}`;
}

export function logout() {
  auth = null;
  localStorage.removeItem(AUTH_KEY);
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error('Spotify token error ' + res.status);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

/** Call on boot: finishes the OAuth round-trip if we're on /callback. */
export async function handleCallback(): Promise<boolean> {
  if (location.pathname !== '/callback') return false;
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const clientId = q.get('state');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  history.replaceState(null, '', '/');
  if (!code || !clientId || !verifier) return false;
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  auth = { access: t.access_token, refresh: t.refresh_token!, expires: Date.now() + t.expires_in * 1000, clientId };
  saveJson(AUTH_KEY, auth);
  return true;
}

export async function token(): Promise<string> {
  if (!auth) throw new Error('Not logged in to Spotify');
  if (Date.now() > auth.expires - 60_000) {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: auth.clientId });
    auth = { ...auth, access: t.access_token, refresh: t.refresh_token || auth.refresh, expires: Date.now() + t.expires_in * 1000 };
    saveJson(AUTH_KEY, auth);
  }
  return auth.access;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch('https://api.spotify.com/v1' + path, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (res.status === 204 || res.status === 202) return undefined as T;
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface SpPreset {
  uri: string;
  name: string;
  owner?: string;
  image?: string;
  kind: 'playlist' | 'album';
  tracks?: number;
}

type Img = { url: string }[] | null;

export async function playlists(): Promise<SpPreset[]> {
  const r = await api<{ items: { uri: string; name: string; images: Img; owner: { display_name: string }; tracks?: { total: number } }[] }>(
    '/me/playlists?limit=50',
  );
  return r.items.filter(Boolean).map((p) => ({
    uri: p.uri,
    name: p.name,
    owner: p.owner?.display_name,
    image: p.images?.[0]?.url,
    kind: 'playlist',
    tracks: p.tracks?.total,
  }));
}

export async function savedAlbums(): Promise<SpPreset[]> {
  const r = await api<{ items: { album: { uri: string; name: string; images: Img; artists: { name: string }[]; total_tracks: number } }[] }>(
    '/me/albums?limit=50',
  );
  return r.items.map(({ album: a }) => ({
    uri: a.uri,
    name: a.name,
    owner: a.artists.map((x) => x.name).join(', '),
    image: a.images?.[0]?.url,
    kind: 'album',
    tracks: a.total_tracks,
  }));
}

export async function playContext(deviceId: string, uri: string) {
  await api(`/me/player/play?device_id=${deviceId}`, { method: 'PUT', body: JSON.stringify({ context_uri: uri }) });
}

// ── Web Playback SDK ───────────────────────────────────────────────────

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (opts: object) => SpPlayer };
  }
}

export interface SpTrackState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: { name: string; uri: string; artists: { name: string }[]; album: { name: string; images: { url: string }[] } };
  };
}

export interface SpPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(ev: string, cb: (x: never) => void): void;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  getCurrentState(): Promise<SpTrackState | null>;
  activateElement?(): Promise<void>;
}

let sdkPromise: Promise<void> | null = null;

export function loadSdk() {
  sdkPromise ??= new Promise<void>((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
  });
  return sdkPromise;
}
