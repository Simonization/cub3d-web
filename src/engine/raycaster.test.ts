import { describe, expect, it } from 'vitest';

import { parseCub } from '../format/cub';
import type { Surface } from './framebuffer';
import { Player } from './player';
import { castRay, hasLineOfSight, renderScene } from './raycaster';
import { solidTexture } from './textures';

/** renderScene only touches data/zbuffer, so the ImageData view is not needed here. */
function testSurface(width: number, height: number): Surface {
  return {
    width,
    height,
    data: new Uint32Array(width * height),
    image: null as unknown as ImageData,
    zbuffer: new Float32Array(width),
  };
}

/**
 * Odd width with palindromic rows and the spawn on the centre column, so the room
 * mirrors exactly about x = 10.5. Hand-writing this is easy to get subtly wrong,
 * so the first test below checks the fixture itself before anything relies on it.
 */
const GRID_WIDTH = 21;
const CENTRE = (GRID_WIDTH - 1) / 2;
const PILLARS = [5, 6, 7, 13, 14, 15];

const row = (walls: readonly number[] = [], spawn?: number): string =>
  Array.from({ length: GRID_WIDTH }, (_, x) => {
    if (x === spawn) return 'N';
    return x === 0 || x === GRID_WIDTH - 1 || walls.includes(x) ? '1' : '0';
  }).join('');

const SYMMETRIC_GRID = [
  '1'.repeat(GRID_WIDTH),
  row(),
  row(PILLARS),
  row([5, 7, 13, 15]),
  row([], CENTRE),
  row([5, 7, 13, 15]),
  row(PILLARS),
  row(),
  '1'.repeat(GRID_WIDTH),
];

const SYMMETRIC = ['NO ./a.png', 'SO ./b.png', 'WE ./c.png', 'EA ./d.png', 'F 0,0,0', 'C 0,0,0', '', ...SYMMETRIC_GRID, ''].join('\n');

function render(cub: string, width = 480, height = 270) {
  const parsed = parseCub(cub);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '));
  const surface = testSurface(width, height);
  const player = new Player();
  player.setAspect(width, height);
  player.spawn(parsed.level.spawn.x, parsed.level.spawn.y, parsed.level.spawn.facing);
  const texture = solidTexture(0xffffff);
  renderScene(
    surface,
    parsed.level.grid,
    player,
    { NO: texture, SO: texture, WE: texture, EA: texture },
    parsed.level.ceiling,
    parsed.level.floor,
  );
  return { surface, player, grid: parsed.level.grid };
}

describe('renderScene', () => {
  it('uses a fixture that is genuinely mirror-symmetric', () => {
    for (const row of SYMMETRIC_GRID) {
      expect(row).toHaveLength(21);
      expect([...row].reverse().join('')).toBe(row);
    }
    // The spawn must sit on the centre column for the mirror axis to pass through it.
    const spawnRow = SYMMETRIC_GRID.find((row) => row.includes('N'))!;
    expect(spawnRow.indexOf('N')).toBe(10);
  });

  it('is mirror-symmetric when the room and the player are', () => {
    const { surface } = render(SYMMETRIC);
    const z = surface.zbuffer;
    let worst = 0;
    for (let i = 0; i < z.length >> 1; i++) {
      worst = Math.max(worst, Math.abs(z[i]! - z[z.length - 1 - i]!));
    }
    // Not exactly 0: column i and its mirror sample cameraX values that differ by
    // one column's width, because cameraX spans [-1, 1).
    expect(worst).toBeLessThan(0.05);
  });

  it('measures the centre column against the wall the map actually puts there', () => {
    const { surface } = render(SYMMETRIC);
    // Spawn is (10, 4) facing north; the north wall's inner face is y = 1.
    expect(surface.zbuffer[240]).toBeCloseTo(3.5, 3);
  });

  it('writes a finite distance for every column', () => {
    const { surface } = render(SYMMETRIC);
    expect([...surface.zbuffer].every((d) => Number.isFinite(d) && d > 0)).toBe(true);
  });
});

describe('castRay', () => {
  const grid = ['11111', '10001', '10001', '10001', '11111'];

  it('measures a straight shot to the far wall', () => {
    expect(castRay(grid, 1.5, 2.5, 1, 0).distance).toBeCloseTo(2.5, 6);
  });

  it('reports which face it struck', () => {
    expect(castRay(grid, 2.5, 2.5, 1, 0).side).toBe(false);
    expect(castRay(grid, 2.5, 2.5, 0, -1).side).toBe(true);
  });

  it('terminates instead of looping when the grid is open', () => {
    expect(castRay(['000', '000', '000'], 1.5, 1.5, 1, 0).distance).toBeCloseTo(1.5, 6);
  });
});

describe('hasLineOfSight', () => {
  const grid = ['1111111', '1000001', '1001001', '1000001', '1111111'];

  it('sees across an open room', () => {
    expect(hasLineOfSight(grid, 1.5, 1.5, 5.5, 1.5)).toBe(true);
  });

  it('is blocked by the pillar', () => {
    expect(hasLineOfSight(grid, 1.5, 2.5, 5.5, 2.5)).toBe(false);
  });

  it('sees around the pillar', () => {
    expect(hasLineOfSight(grid, 1.5, 1.5, 5.5, 1.5)).toBe(true);
  });
});
