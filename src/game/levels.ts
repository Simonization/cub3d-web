/**
 * Level 0: the sandbox. Open, harmless, and the room the editors exist to change.
 *
 * Built rather than typed out: the width is odd and the spawn sits on the centre
 * column so the room is exactly symmetric, which is fiddly to get right by hand and
 * obvious when it is wrong. `levels.test.ts` holds it to that.
 */
const WIDTH = 21;
const HEIGHT = 13;
export const SANDBOX_PILLARS = [5, 6, 7, 13, 14, 15];
const PILLAR_ROWS = new Set([3, 4, 5, 7, 8, 9]);

function sandboxGrid(): string[] {
  const spawnX = (WIDTH - 1) / 2;
  const spawnY = (HEIGHT - 1) / 2;
  return Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => {
      if (x === spawnX && y === spawnY) return 'N';
      if (y === 0 || y === HEIGHT - 1 || x === 0 || x === WIDTH - 1) return '1';
      return PILLAR_ROWS.has(y) && SANDBOX_PILLARS.includes(x) ? '1' : '0';
    }).join(''),
  );
}

export const SANDBOX_GRID = sandboxGrid();

export const SANDBOX_CUB = [
  'NO ./textures/greystone.png',
  'SO ./textures/mossy.png',
  'WE ./textures/greystone.png',
  'EA ./textures/o.png',
  '',
  'F 64,68,78',
  'C 22,25,34',
  '',
  ...SANDBOX_GRID,
  '',
].join('\n');

/** Wall textures that ship with the build, offered as presets in the colour editor. */
export const BUILTIN_TEXTURES: ReadonlyArray<{ path: string; label: string }> = [
  { path: './textures/greystone.png', label: 'greystone' },
  { path: './textures/mossy.png', label: 'mossy' },
  { path: './textures/o.png', label: 'panel' },
];
