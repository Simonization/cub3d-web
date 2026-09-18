import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packRGB, parseCub, serializeCub, unpackRGB, validateWalls } from './cub';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

describe('parity with the C parser', () => {
  it('accepts test_map.cub', () => {
    const result = parseCub(fixture('test_map.cub'));
    expect(result.ok ? null : result.errors).toBeNull();
  });

  it('accepts big_map.cub', () => {
    const result = parseCub(fixture('big_map.cub'));
    expect(result.ok ? null : result.errors).toBeNull();
  });

  // Verified against a harness built from the real C parse/*.c: it prints exactly
  // "Invalid character in map area" and exits before wall validation runs. The
  // ragged rows in this file are in fact still enclosed, so they are not the fault.
  it('rejects mapsimon.cub on its trailing garbage line', () => {
    const result = parseCub(fixture('mapsimon.cub'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = result.errors.map((e) => e.message);
    expect(messages).toContain('Invalid character in map area');
    expect(messages).not.toContain('Map not surrounded by walls');
  });

  it('reads the header regardless of declaration order', () => {
    const result = parseCub(fixture('mapsimon.cub'));
    expect(result.ok).toBe(false);
    // mapsimon declares NO, WE, SO, EA, then C before F.
    if (!result.ok) {
      expect(result.errors.map((e) => e.message)).not.toContain(
        'Incomplete texture/color. Need 6 elements.',
      );
    }
  });
});

const MINIMAL = `NO ./a.xpm
SO ./b.xpm
WE ./c.xpm
EA ./d.xpm
F 220,100,0
C 225,30,0

111
1N1
111
`;

describe('grammar', () => {
  it('parses a minimal map', () => {
    const result = parseCub(MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.level.spawn).toEqual({ x: 1, y: 1, facing: 'N' });
    expect(result.level.floor).toBe(packRGB(220, 100, 0));
    expect(result.level.grid).toEqual(['111', '1N1', '111']);
  });

  it('accepts a pure black floor, which the C main() wrongly treats as unset', () => {
    const result = parseCub(MINIMAL.replace('F 220,100,0', 'F 0,0,0'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.level.floor).toBe(0);
  });

  it('rejects an RGB component above 255', () => {
    const result = parseCub(MINIMAL.replace('F 220,100,0', 'F 220,256,0'));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric RGB component', () => {
    const result = parseCub(MINIMAL.replace('F 220,100,0', 'F 220,1e2,0'));
    expect(result.ok).toBe(false);
  });

  it('rejects two spawns', () => {
    const result = parseCub(MINIMAL.replace('1N1', 'NNN').replace('111\n111', '111'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message)).toContain('Multiple player positions in map');
    }
  });

  it('rejects a missing identifier', () => {
    const result = parseCub(MINIMAL.replace('C 225,30,0\n', ''));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message)).toContain(
        'Incomplete texture/color. Need 6 elements.',
      );
    }
  });

  it('rejects content after the map block', () => {
    const result = parseCub(MINIMAL + '\nnot a map\n');
    expect(result.ok).toBe(false);
  });
});

describe('validateWalls', () => {
  it('accepts a closed room', () => {
    expect(validateWalls(['111', '101', '111'])).toEqual([]);
  });

  it('flags an opening in the wall', () => {
    const errors = validateWalls(['111', '100', '111']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'Map not surrounded by walls', line: 1, col: 2 });
  });

  it('treats a space as an opening, not a wall', () => {
    expect(validateWalls(['111', '1 1', '101', '111'])).toEqual([
      { message: 'Map not surrounded by walls', line: 2, col: 1 },
    ]);
  });

  it('allows ragged rows as long as every open cell is enclosed', () => {
    expect(validateWalls(['  111', '  101', '11111', '10001', '11111'])).toEqual([]);
  });
});

describe('RGB packing', () => {
  it('packs the way rgb_utils.c does', () => {
    expect(packRGB(220, 100, 0)).toBe(0x00dc6400);
    expect(packRGB(255, 255, 255)).toBe(0x00ffffff);
  });

  it('round-trips', () => {
    expect(unpackRGB(packRGB(12, 34, 56))).toEqual([12, 34, 56]);
  });
});

describe('serializeCub', () => {
  it('round-trips through the parser', () => {
    const first = parseCub(MINIMAL);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseCub(serializeCub(first.level));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.level).toEqual(first.level);
  });
});
