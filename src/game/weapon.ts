/**
 * Shooting, and the question of whether you hit.
 *
 * The C bonus has `fire()` (src_bonus/weapon_bonus.c:15), which throws away the mouse
 * coordinates and only starts an animation — there is no notion of a target. So the
 * flipbook is reused and the hit test is new.
 *
 * A shot is a hitscan: a ray from the player along the direction they face, tested
 * against each enemy as a circle.
 *
 *   v     = enemy - player
 *   along = v · dir                    how far down the ray the enemy sits
 *   perp  = |v.x*dir.y - v.y*dir.x|    how far to the SIDE of the ray it sits
 *
 * `dir` is a unit vector, so that cross product is exactly the perpendicular distance
 * from the enemy's centre to the line of the shot. It is the whole answer to "did I
 * hit him or shoot past him": `perp <= radius` is a hit, and anything larger is a miss
 * by `perp - radius` tiles. `along < wallDistance` is the second half — it is what
 * stops you shooting through walls, and it is why the wall ray is cast first.
 *
 * DOOM did the same thing with more machinery: P_AimLineAttack walked the blockmap and
 * auto-aimed vertically, because the player had no way to look up or down.
 */

import { castRay } from '../engine/raycaster';
import type { Player } from '../engine/player';
import type { Enemy } from './enemy';

export const WEAPON_FRAMES = 7;
const FRAME_SECONDS = 0.045;
const COOLDOWN = 0.36;

/** Forgiveness, in tiles, added to the target radius; a little, and less far away. */
const AIM_ASSIST_NEAR = 0.16;
const ASSIST_FALLOFF = 12;

export interface ShotResult {
  enemy: Enemy | null;
  /** Distance along the ray to whatever stopped it. */
  distance: number;
  /** For the nearest enemy that was in front of you: how far the shot passed from its centre. */
  missedBy: number | null;
}

export function traceShot(
  grid: string[],
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  enemies: readonly Enemy[],
): ShotResult {
  const wall = castRay(grid, originX, originY, dirX, dirY);
  let best: Enemy | null = null;
  let bestAlong = Infinity;
  let closestMiss: number | null = null;

  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const vx = enemy.x - originX;
    const vy = enemy.y - originY;

    const along = vx * dirX + vy * dirY;
    if (along <= 0) continue;

    const perp = Math.abs(vx * dirY - vy * dirX);
    const assist = AIM_ASSIST_NEAR * Math.max(0, 1 - along / ASSIST_FALLOFF);
    const reach = enemy.kind.radius + assist;

    if (perp > reach) {
      const miss = perp - enemy.kind.radius;
      if (closestMiss === null || miss < closestMiss) closestMiss = miss;
      continue;
    }
    if (along >= wall.distance) continue;
    if (along < bestAlong) {
      bestAlong = along;
      best = enemy;
    }
  }

  return {
    enemy: best,
    distance: best ? bestAlong : wall.distance,
    missedBy: best ? 0 : closestMiss,
  };
}

export class Weapon {
  frame = 0;
  ammo: number;
  private firing = false;
  private timer = 0;
  private cooldown = 0;
  private bobPhase = 0;
  bobX = 0;
  bobY = 0;

  constructor(
    readonly damage = 10,
    ammo = 40,
  ) {
    this.ammo = ammo;
  }

  get busy(): boolean {
    return this.firing || this.cooldown > 0;
  }

  /** Returns true when a round actually left the barrel. */
  tryFire(): boolean {
    if (this.busy || this.ammo <= 0) return false;
    this.firing = true;
    this.frame = 1;
    this.timer = 0;
    this.cooldown = COOLDOWN;
    this.ammo--;
    return true;
  }

  update(dt: number, moving: boolean): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.firing) {
      this.timer += dt;
      while (this.timer >= FRAME_SECONDS) {
        this.timer -= FRAME_SECONDS;
        this.frame++;
        if (this.frame >= WEAPON_FRAMES) {
          this.frame = 0;
          this.firing = false;
          break;
        }
      }
    }

    // The same cosmetic sway the C bonus applies in get_weapon_bob().
    if (moving) this.bobPhase += dt * 7.5;
    const settle = moving ? 1 : Math.max(0, 1 - dt * 6);
    this.bobX = Math.cos(this.bobPhase) * 9 * settle;
    this.bobY = Math.abs(Math.sin(this.bobPhase)) * 7 * settle;
  }
}

export function shoot(
  grid: string[],
  player: Player,
  enemies: readonly Enemy[],
  weapon: Weapon,
): ShotResult | null {
  if (!weapon.tryFire()) return null;
  return traceShot(grid, player.x, player.y, player.dirX, player.dirY, enemies);
}
