// What's on display on the wall shelves.
//
// You can own far more than fits on a shelf, so each shelf shows, in order:
//   1. what you've pinned ("put on the shelf"),
//   2. what you've played recently,
//   3. what was added to your library most recently.
// The rest stays in the cabinet (the pull-out drawer). Pins and play history
// are saved on the server, so the rack and the phone remote share them.

import { useEffect, useState } from 'react';
import * as plex from './sources/plex';
import type { PlexItem } from './sources/plex';
import type { Rom } from './store';

export type ShelfKind = 'dvd' | 'cd' | 'game';
export type ShelfItem = PlexItem | Rom;

interface ShelfData {
  pins: Record<ShelfKind, ShelfItem[]>;
  history: Record<ShelfKind, ShelfItem[]>;
}

const empty = (): ShelfData => ({ pins: { dvd: [], cd: [], game: [] }, history: { dvd: [], cd: [], game: [] } });

let data = empty();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const itemId = (i: ShelfItem) => ('ratingKey' in i ? i.ratingKey : i.id);

/** Keep only what a shelf needs; Plex items carry a lot of baggage. */
function slim(i: ShelfItem): ShelfItem {
  if (!('ratingKey' in i)) return { id: i.id, name: i.name, system: i.system, url: i.url };
  const keep = ['ratingKey', 'key', 'type', 'title', 'parentTitle', 'grandparentTitle', 'year', 'thumb', 'parentThumb', 'grandparentThumb', 'duration', 'leafCount', 'addedAt', 'demo'] as const;
  return Object.fromEntries(keep.filter((k) => i[k] !== undefined).map((k) => [k, i[k]])) as unknown as PlexItem;
}

export async function loadShelves() {
  try {
    const r = await fetch('/api/shelves');
    if (r.ok) data = { ...empty(), ...(await r.json()) };
  } catch {
    /* keep what we have */
  }
  notify();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  notify();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/shelves', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
  }, 300);
}

export function isPinned(kind: ShelfKind, item: ShelfItem) {
  return data.pins[kind].some((p) => itemId(p) === itemId(item));
}

export function togglePin(kind: ShelfKind, item: ShelfItem) {
  const pins = data.pins[kind];
  data = {
    ...data,
    pins: { ...data.pins, [kind]: isPinned(kind, item) ? pins.filter((p) => itemId(p) !== itemId(item)) : [slim(item), ...pins] },
  };
  save();
}

/** Called whenever something is played, so it drifts to the front of its shelf. */
export function notePlayed(kind: ShelfKind, item: ShelfItem) {
  if ('ratingKey' in item && item.demo) return;
  // An episode puts its show on the shelf, the way you'd shelve the box set.
  if ('ratingKey' in item && item.type === 'episode' && item.grandparentRatingKey) {
    item = {
      ratingKey: item.grandparentRatingKey,
      key: `/library/metadata/${item.grandparentRatingKey}`,
      type: 'show',
      title: item.grandparentTitle ?? item.title,
      thumb: item.grandparentThumb,
    };
  }
  const id = itemId(item);
  const history = [slim(item), ...data.history[kind].filter((h) => itemId(h) !== id)].slice(0, 60);
  data = { ...data, history: { ...data.history, [kind]: history } };
  save();
}

export function useShelfData() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return data;
}

// ── Recently added (the filler) ────────────────────────────────────────

const recentCache: Partial<Record<ShelfKind, Promise<ShelfItem[]>>> = {};

async function recentPlex(types: { type: 'movie' | 'show' | 'artist'; plexType: number }[]): Promise<PlexItem[]> {
  const sections = await plex.sections();
  const lists = await Promise.all(
    sections.flatMap((s) =>
      types
        .filter((t) => t.type === s.type)
        .map((t) => plex.query(`/library/sections/${s.key}/all?type=${t.plexType}&sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=60`)),
    ),
  );
  return lists.flat().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

function recent(kind: ShelfKind, plexOn: boolean): Promise<ShelfItem[]> {
  const key = `${kind}:${plexOn}` as ShelfKind;
  recentCache[key] ??= (async () => {
    if (kind === 'game') return fetch('/api/roms').then((r) => r.json() as Promise<Rom[]>);
    if (!plexOn) return kind === 'dvd' ? plex.DEMO_MOVIES : plex.DEMO_ALBUMS;
    if (kind === 'dvd')
      return recentPlex([
        { type: 'movie', plexType: 1 },
        { type: 'show', plexType: 2 },
      ]);
    return recentPlex([{ type: 'artist', plexType: 9 }]);
  })().catch(() => []);
  return recentCache[key]!;
}

/** The items standing on a shelf, best first. */
export function useDisplay(kind: ShelfKind, plexOn: boolean, limit = 80) {
  const d = useShelfData();
  const [filler, setFiller] = useState<ShelfItem[]>([]);
  useEffect(() => {
    let live = true;
    recent(kind, plexOn).then((r) => live && setFiller(r));
    return () => {
      live = false;
    };
  }, [kind, plexOn]);

  const seen = new Set<string>();
  const out: { item: ShelfItem; pinned: boolean }[] = [];
  const add = (item: ShelfItem, pinned: boolean) => {
    const id = itemId(item);
    if (seen.has(id) || out.length >= limit) return;
    seen.add(id);
    out.push({ item, pinned });
  };
  d.pins[kind].forEach((i) => add(i, true));
  d.history[kind].forEach((i) => add(i, false));
  filler.forEach((i) => add(i, false));
  return out;
}
