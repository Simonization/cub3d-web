import { describe, expect, it } from 'vitest';

import { parseCub } from '../format/cub';
import { SANDBOX_CUB, SANDBOX_GRID } from './levels';

describe('sandbox level', () => {
  it('parses', () => {
    const result = parseCub(SANDBOX_CUB);
    expect(result.ok ? null : result.errors).toBeNull();
  });

  it('is mirror-symmetric, so the view at spawn is too', () => {
    for (const row of SANDBOX_GRID) {
      expect([...row].reverse().join('')).toBe(row);
    }
    expect([...SANDBOX_GRID].reverse()).toEqual(SANDBOX_GRID);
  });

  it('spawns the player on the centre tile', () => {
    const result = parseCub(SANDBOX_CUB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { spawn, grid } = result.level;
    expect(spawn.x).toBe((grid[0]!.length - 1) / 2);
    expect(spawn.y).toBe((grid.length - 1) / 2);
  });

  it('leaves no tile walled off from the rest of the room', () => {
    const result = parseCub(SANDBOX_CUB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { grid, spawn } = result.level;

    const seen = new Set<string>();
    const queue = [[spawn.x, spawn.y] as const];
    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      if (grid[y]?.[x] === undefined || grid[y]![x] === '1') continue;
      seen.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    const open = grid.join('').split('').filter((ch) => ch !== '1').length;
    expect(seen.size).toBe(open);
  });
});
