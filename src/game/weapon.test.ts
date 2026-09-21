import { describe, expect, it } from 'vitest';

import { Enemy, GRUNT } from './enemy';
import { traceShot } from './weapon';

/** A 9x5 corridor with a pillar at (4,2). */
const GRID = [
  '111111111',
  '100000001',
  '100010001',
  '100000001',
  '111111111',
];

const at = (x: number, y: number) => new Enemy(GRUNT, x, y);

/** Shooting east from just inside the west wall. */
const eastFrom = (y: number, enemies: Enemy[], x = 1.5) =>
  traceShot(GRID, x, y, 1, 0, enemies);

describe('traceShot', () => {
  it('hits an enemy standing dead ahead', () => {
    const grunt = at(6.5, 1.5);
    const shot = eastFrom(1.5, [grunt]);
    expect(shot.enemy).toBe(grunt);
    expect(shot.missedBy).toBe(0);
    expect(shot.distance).toBeCloseTo(5, 5);
  });

  it('hits when the shot passes within the radius, not only through the centre', () => {
    // GRUNT.radius is 0.34; offset the enemy by 0.3 tiles from the line of fire.
    const shot = eastFrom(1.5, [at(6.5, 1.8)]);
    expect(shot.enemy).not.toBeNull();
  });

  it('misses when the shot passes outside the radius, and says by how much', () => {
    const shot = eastFrom(1.5, [at(6.5, 2.4)]);
    expect(shot.enemy).toBeNull();
    // 0.9 tiles to the side, minus the 0.34 radius.
    expect(shot.missedBy).toBeCloseTo(0.9 - GRUNT.radius, 5);
  });

  it('does not shoot through a wall', () => {
    // The pillar at (4,2) stands between the player and the enemy on row 2.
    const shot = eastFrom(2.5, [at(6.5, 2.5)]);
    expect(shot.enemy).toBeNull();
    expect(shot.distance).toBeCloseTo(2.5, 5);
  });

  it('ignores an enemy standing behind the player', () => {
    const shot = traceShot(GRID, 6.5, 1.5, 1, 0, [at(2.5, 1.5)]);
    expect(shot.enemy).toBeNull();
  });

  it('hits the nearer of two enemies in line', () => {
    const near = at(4.5, 1.5);
    const far = at(7.5, 1.5);
    const shot = eastFrom(1.5, [far, near]);
    expect(shot.enemy).toBe(near);
  });

  it('ignores corpses', () => {
    const corpse = at(6.5, 1.5);
    corpse.setState('CORPSE');
    expect(eastFrom(1.5, [corpse]).enemy).toBeNull();
  });

  it('reports the wall distance when nothing is hit', () => {
    const shot = eastFrom(1.5, []);
    expect(shot.enemy).toBeNull();
    expect(shot.distance).toBeCloseTo(6.5, 5);
    expect(shot.missedBy).toBeNull();
  });

  it('gives a little aim assist up close and less far away', () => {
    // Just outside the radius: forgiven near the player, not at a distance.
    const near = traceShot(GRID, 1.5, 1.5, 1, 0, [at(2.5, 1.5 + GRUNT.radius + 0.08)]);
    const far = traceShot(GRID, 1.5, 1.5, 1, 0, [at(7.5, 1.5 + GRUNT.radius + 0.08)]);
    expect(near.enemy).not.toBeNull();
    expect(far.enemy).toBeNull();
  });
});
