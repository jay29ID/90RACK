// Game systems the deck understands. `core` is the EmulatorJS core name.
// A ROM is matched first by its parent folder name (roms/snes/…), then by
// file extension, so ambiguous extensions like .bin/.iso need a folder.

export const SYSTEMS = [
  { id: 'nes', name: 'Nintendo', short: 'NES', core: 'nes', folders: ['nes', 'famicom'], exts: ['nes', 'fds', 'unf'] },
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', core: 'snes', folders: ['snes', 'sfc', 'superfamicom'], exts: ['sfc', 'smc'] },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', core: 'n64', folders: ['n64'], exts: ['n64', 'z64', 'v64'] },
  { id: 'gb', name: 'Game Boy', short: 'GB', core: 'gb', folders: ['gb', 'gameboy'], exts: ['gb'] },
  { id: 'gbc', name: 'Game Boy Color', short: 'GBC', core: 'gb', folders: ['gbc'], exts: ['gbc'] },
  { id: 'gba', name: 'Game Boy Advance', short: 'GBA', core: 'gba', folders: ['gba'], exts: ['gba'] },
  { id: 'genesis', name: 'Sega Genesis', short: 'GEN', core: 'segaMD', folders: ['genesis', 'megadrive', 'md'], exts: ['md', 'gen', 'smd'] },
  { id: 'sms', name: 'Sega Master System', short: 'SMS', core: 'segaMS', folders: ['sms', 'mastersystem'], exts: ['sms'] },
  { id: 'gg', name: 'Game Gear', short: 'GG', core: 'segaGG', folders: ['gg', 'gamegear'], exts: ['gg'] },
  { id: 'psx', name: 'PlayStation', short: 'PSX', core: 'psx', folders: ['psx', 'ps1', 'playstation'], exts: ['cue', 'pbp', 'chd'] },
  { id: 'pce', name: 'TurboGrafx-16', short: 'TG16', core: 'pce', folders: ['pce', 'tg16', 'turbografx'], exts: ['pce'] },
  { id: 'atari2600', name: 'Atari 2600', short: '2600', core: 'atari2600', folders: ['atari2600', '2600'], exts: ['a26'] },
  { id: 'arcade', name: 'Arcade', short: 'ARC', core: 'arcade', folders: ['arcade', 'mame', 'fbneo'], exts: [] },
];

const ZIPS = ['zip', '7z', 'bin', 'iso', 'img'];

export function systemForFile(rel) {
  const parts = rel.toLowerCase().split(/[\\/]/);
  const ext = parts.at(-1).split('.').pop();
  for (const folder of parts.slice(0, -1)) {
    const sys = SYSTEMS.find((s) => s.folders.includes(folder));
    if (sys && (sys.exts.includes(ext) || ZIPS.includes(ext))) return sys;
  }
  return SYSTEMS.find((s) => s.exts.includes(ext)) || null;
}
