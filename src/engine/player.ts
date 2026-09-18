/**
 * Port of src/movement/move.c and direction.c, in tile units rather than the C's
 * pixel units (BLOCK_SIZE = 64), and time-scaled rather than per-frame.
 */

import type { Facing } from '../format/cub';
import { isWall } from '../format/cub';

/** The C moves 5 px/frame and rotates 0.05 rad/frame at roughly 60fps. */
export const MOVE_SPEED = (5 * 60) / 64;
export const RUN_MULTIPLIER = 1.7;
export const ROTATE_SPEED = 0.05 * 60;
/** The C tests a 20x20 px box around the player; 10/64 of a tile. */
export const PLAYER_RADIUS = 10 / 64;

const FACING_ANGLE: Record<Facing, number> = {
  E: 0,
  N: Math.PI / 2,
  W: Math.PI,
  S: (3 * Math.PI) / 2,
};

export interface MoveIntent {
  forward: number;
  strafe: number;
  turn: number;
  run: boolean;
}

export class Player {
  x = 0;
  y = 0;
  angle = 0;
  dirX = 1;
  dirY = 0;
  planeX = 0;
  planeY = 1;
  /** Vertical look, in pixels of screen shift — the same fake pitch the C bonus uses. */
  pitch = 0;
  bob = 0;

  private planeLength = 0.66;

  spawn(x: number, y: number, facing: Facing): void {
    this.x = x + 0.5;
    this.y = y + 0.5;
    this.angle = FACING_ANGLE[facing];
    this.updateVectors();
  }

  /**
   * planeLength = width / (2 * height) is the value that makes world pixels square:
   * at 4:3 it is the 0.66 the C hardcodes at spawn, and it widens correctly for 16:9.
   */
  setAspect(width: number, height: number): void {
    this.planeLength = width / (2 * height);
    this.updateVectors();
  }

  private updateVectors(): void {
    this.dirX = Math.cos(this.angle);
    this.dirY = -Math.sin(this.angle);
    this.planeX = -this.dirY * this.planeLength;
    this.planeY = this.dirX * this.planeLength;
  }

  rotate(radians: number): void {
    this.angle = (this.angle + radians) % (2 * Math.PI);
    if (this.angle < 0) this.angle += 2 * Math.PI;
    this.updateVectors();
  }

  update(intent: MoveIntent, grid: string[], dt: number): void {
    if (intent.turn !== 0) this.rotate(-intent.turn * ROTATE_SPEED * dt);

    let { forward, strafe } = intent;
    const magnitude = Math.hypot(forward, strafe);
    // The C lets W+D move sqrt(2) times faster; normalising is the fix.
    if (magnitude > 1) {
      forward /= magnitude;
      strafe /= magnitude;
    }
    if (forward === 0 && strafe === 0) return;

    const speed = MOVE_SPEED * (intent.run ? RUN_MULTIPLIER : 1) * dt;
    const stepX = (this.dirX * forward + this.dirY * strafe) * speed;
    const stepY = (this.dirY * forward - this.dirX * strafe) * speed;

    // Axis-separated, like validate_move, so the player slides along walls.
    if (isFree(grid, this.x + stepX, this.y)) this.x += stepX;
    if (isFree(grid, this.x, this.y + stepY)) this.y += stepY;

    this.bob += Math.hypot(stepX, stepY);
  }
}

/** Port of is_free: all four corners of the hitbox must be clear. */
export function isFree(grid: string[], x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    !isWall(grid, Math.floor(x + r), Math.floor(y + r)) &&
    !isWall(grid, Math.floor(x - r), Math.floor(y + r)) &&
    !isWall(grid, Math.floor(x + r), Math.floor(y - r)) &&
    !isWall(grid, Math.floor(x - r), Math.floor(y - r))
  );
}

/**
 * The C map never changes at runtime, so nothing there handles a player who is
 * already inside a wall. The editor can produce exactly that, and because the two
 * axis tests then both fail the player would be stuck forever. Spiral outwards for
 * the nearest tile centre that clears.
 */
export function ejectFromWall(grid: string[], player: Player): boolean {
  if (isFree(grid, player.x, player.y)) return false;

  const originX = Math.floor(player.x);
  const originY = Math.floor(player.y);
  for (let ring = 1; ring < 64; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cx = originX + dx + 0.5;
        const cy = originY + dy + 0.5;
        if (isFree(grid, cx, cy)) {
          player.x = cx;
          player.y = cy;
          return true;
        }
      }
    }
  }
  return false;
}
