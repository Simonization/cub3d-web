/**
 * Port of src/parse/*.c from the C cub3D.
 *
 * Deliberate difference: the C rejects any texture path not ending in `.xpm` and
 * sniffs the file's first 255 bytes. A browser has neither the extension
 * convention nor the file, so paths are accepted as opaque keys. Everything else
 * — the grammar, the 4-neighbour wall check, the RGB rules — matches the C, and
 * the error strings are reused verbatim so the editor teaches the real thing.
 */

export type Facing = 'N' | 'S' | 'E' | 'W';

export interface CubLevel {
  textures: Record<'NO' | 'SO' | 'WE' | 'EA', string>;
  floor: number;
  ceiling: number;
  grid: string[];
  spawn: { x: number; y: number; facing: Facing };
}

export interface CubError {
  message: string;
  /** 0-indexed row within the whole file, when the error has a location. */
  line?: number;
  col?: number;
}

export type CubResult = { ok: true; level: CubLevel } | { ok: false; errors: CubError[] };

const MAP_CHARS = new Set(['0', '1', 'N', 'S', 'E', 'W', ' ']);
const SPAWN_CHARS = new Set(['N', 'S', 'E', 'W']);
const IDENTIFIERS = ['NO', 'SO', 'WE', 'EA', 'F', 'C'] as const;

export const packRGB = (r: number, g: number, b: number): number =>
  ((r << 16) | (g << 8) | b) >>> 0;

export const unpackRGB = (c: number): [number, number, number] => [
  (c >> 16) & 0xff,
  (c >> 8) & 0xff,
  c & 0xff,
];

/** Mirrors is_valid_rgb_component: digits only, non-empty, 0..255. */
function parseComponent(part: string): number | null {
  const t = part.trim();
  if (t.length === 0 || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= 255 ? n : null;
}

function parseRGB(value: string): number | null {
  const parts = value.split(',');
  if (parts.length !== 3) return null;
  const rgb = parts.map(parseComponent);
  if (rgb.some((n) => n === null)) return null;
  return packRGB(rgb[0]!, rgb[1]!, rgb[2]!);
}

/** A line belongs to the map block if it is non-empty and uses only map characters. */
function isMapLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  return [...t].every((ch) => MAP_CHARS.has(ch));
}

export function parseCub(text: string): CubResult {
  const errors: CubError[] = [];
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));

  const textures: Partial<Record<'NO' | 'SO' | 'WE' | 'EA', string>> = {};
  let floor: number | null = null;
  let ceiling: number | null = null;
  const seen = new Set<string>();

  let i = 0;
  for (; i < lines.length && seen.size < IDENTIFIERS.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const id = IDENTIFIERS.find(
      (k) => trimmed === k || trimmed.startsWith(k + ' ') || trimmed.startsWith(k + '\t'),
    );
    if (!id) break;

    const value = trimmed.slice(id.length).trim();
    if (seen.has(id)) {
      errors.push({ message: `Duplicate ${id} declaration.`, line: i });
      continue;
    }
    seen.add(id);

    if (value.length === 0) {
      errors.push({ message: `${id} has no value.`, line: i });
      continue;
    }
    if (id === 'F' || id === 'C') {
      const colour = parseRGB(value);
      if (colour === null) {
        errors.push({ message: `Invalid RGB for ${id}. Expected three values 0-255.`, line: i });
        continue;
      }
      if (id === 'F') floor = colour;
      else ceiling = colour;
    } else {
      textures[id] = value;
    }
  }

  if (seen.size < IDENTIFIERS.length) {
    errors.push({ message: 'Incomplete texture/color. Need 6 elements.' });
  }

  // Everything from here to EOF is the map area; the C forbids stray characters
  // in the whole region, not just inside the block it ends up keeping.
  for (let j = i; j < lines.length; j++) {
    const line = lines[j]!;
    for (let c = 0; c < line.length; c++) {
      if (!MAP_CHARS.has(line[c]!) && line[c] !== '\t') {
        errors.push({ message: 'Invalid character in map area', line: j, col: c });
      }
    }
    if (line.includes('\t')) {
      errors.push({ message: 'Tabs are not allowed in the map area', line: j });
    }
  }

  let start = i;
  while (start < lines.length && lines[start]!.trim().length === 0) start++;

  let end = start;
  while (end < lines.length && isMapLine(lines[end]!)) end++;

  const grid = lines.slice(start, end);

  for (let j = end; j < lines.length; j++) {
    if (lines[j]!.trim().length > 0) {
      errors.push({ message: 'Double map.', line: j });
      break;
    }
  }

  if (grid.length === 0) {
    errors.push({ message: 'No map found.' });
    return { ok: false, errors };
  }

  const spawns: Array<{ x: number; y: number; facing: Facing }> = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x++) {
      if (SPAWN_CHARS.has(row[x]!)) spawns.push({ x, y, facing: row[x] as Facing });
    }
  }
  if (spawns.length === 0) errors.push({ message: 'No player position in map' });
  else if (spawns.length > 1) {
    errors.push({ message: 'Multiple player positions in map', line: start + spawns[1]!.y });
  }

  for (const err of validateWalls(grid)) {
    errors.push({ ...err, line: err.line! + start });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    level: {
      textures: textures as CubLevel['textures'],
      floor: floor!,
      ceiling: ceiling!,
      grid,
      spawn: spawns[0]!,
    },
  };
}

/**
 * Port of validate_map_walls (src/parse/map_validation.c:42-80). Not a flood fill:
 * every open or spawn cell must have an in-range, non-space neighbour on all four
 * sides. Rows may be ragged, which is why the column bound is per-row.
 */
export function validateWalls(grid: string[]): CubError[] {
  const errors: CubError[] = [];
  const openAt = (x: number, y: number): boolean => {
    if (y < 0 || y >= grid.length) return false;
    const row = grid[y]!;
    if (x < 0 || x >= row.length) return false;
    return row[x] !== ' ';
  };

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch !== '0' && !SPAWN_CHARS.has(ch)) continue;
      if (!openAt(x + 1, y) || !openAt(x - 1, y) || !openAt(x, y + 1) || !openAt(x, y - 1)) {
        errors.push({ message: 'Map not surrounded by walls', line: y, col: x });
      }
    }
  }
  return errors;
}

/** Out-of-range counts as wall, so the DDA always terminates. */
export function isWall(grid: string[], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return true;
  const row = grid[y]!;
  if (x < 0 || x >= row.length) return true;
  return row[x] === '1';
}

export function serializeCub(level: CubLevel): string {
  const [fr, fg, fb] = unpackRGB(level.floor);
  const [cr, cg, cb] = unpackRGB(level.ceiling);
  return [
    `NO ${level.textures.NO}`,
    `SO ${level.textures.SO}`,
    `WE ${level.textures.WE}`,
    `EA ${level.textures.EA}`,
    '',
    `F ${fr},${fg},${fb}`,
    `C ${cr},${cg},${cb}`,
    '',
    ...level.grid,
    '',
  ].join('\n');
}
