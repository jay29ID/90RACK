// What the rack and the phone remote say to each other, via the server relay.

import type { PlexItem } from '../sources/plex';
import type { SpPreset } from '../sources/spotify';
import type { Tape } from '../sources/youtube';
import type { Input, NowPlaying, Rom } from '../store';

export interface RackState {
  power: boolean;
  input: Input;
  volume: number;
  volumeDb: string;
  muted: boolean;
  theater: boolean;
  crt: boolean;
  shelfOpen: boolean;
  dsp: string;
  cdMode: string;
  cdSlot: number;
  cdSlots: ({ ratingKey: string; title: string; artist?: string } | null)[];
  now: NowPlaying | null;
  presets: SpPreset[];
  tunerUri: string | null;
  spotify: boolean; // logged in on the rack
  tapes: Tape[];
  soundBlocked: boolean; // browser is waiting for a click on the TV before it may play sound
}

export type Command =
  | { type: 'power' }
  | { type: 'input'; input: Input }
  | { type: 'volume'; delta?: number; value?: number }
  | { type: 'mute' }
  | { type: 'toggle' | 'stop' | 'next' | 'prev' | 'eject' }
  | { type: 'seek'; seconds: number }
  | { type: 'theater' | 'crt' | 'dsp' | 'shelf' | 'cdMode' }
  | { type: 'cdSlot'; slot: number }
  | { type: 'loadDvd'; item: PlexItem }
  | { type: 'loadCd'; item: PlexItem }
  | { type: 'tune'; uri: string }
  | { type: 'loadTape'; tape: Tape }
  | { type: 'loadCart'; rom: Rom }
  | { type: 'shelvesChanged' };
