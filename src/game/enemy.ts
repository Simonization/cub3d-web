/**
 * Enemies, built the way DOOM built them: as a table of states rather than a tree of
 * conditionals. In `info.c` every actor is driven by `states[]`, where a state is
 * `{ sprite, frame, tics, action, nextstate }`; `P_MobjThinker` counts the tics down,
 * moves to `nextstate` and calls that state's action function. Behaviour is data.
 *
 * Two honest deviations. DOOM gives each animation frame its own state; here a state
 * holds the list of frames it cycles, which is the same machine with less typing.
 * And `P_CheckSight` walks the level BSP, while we already have a DDA — line of sight
 * is the same ray the renderer casts, stopped short.
 */

import { isWall } from '../format/cub';
import { hasLineOfSight } from '../engine/raycaster';

export type StateName =
  | 'IDLE'
  | 'CHASE'
  | 'WINDUP'
  | 'STRIKE'
  | 'RECOVER'
  | 'PAIN'
  | 'DEATH'
  | 'CORPSE';

type Action = 'look' | 'chase' | 'face' | 'strike' | 'none';

interface StateDef {
  /** Atlas rows to cycle; the rotation picks the column. */
  rows: number[];
  /** Seconds per frame — DOOM's `tics`, which ran at 35 per second. */
  seconds: number;
  action: Action;
  next: StateName;
  /** Death plays along one row's frames instead of picking a rotation. */
  sequence?: boolean;
}

export const DEATH_ROW = 8;

const STATES: Record<StateName, StateDef> = {
  IDLE: { rows: [0], seconds: 0.4, action: 'look', next: 'IDLE' },
  CHASE: { rows: [0, 1, 2, 3], seconds: 0.13, action: 'chase', next: 'CHASE' },
  // The windup is the whole reason the first levels are fair: you get to see it coming.
  WINDUP: { rows: [5], seconds: 0.45, action: 'face', next: 'STRIKE' },
  STRIKE: { rows: [6], seconds: 0.22, action: 'strike', next: 'RECOVER' },
  RECOVER: { rows: [7], seconds: 0.35, action: 'none', next: 'CHASE' },
  PAIN: { rows: [7], seconds: 0.2, action: 'none', next: 'CHASE' },
  DEATH: { rows: [DEATH_ROW], seconds: 0.11, action: 'none', next: 'CORPSE', sequence: true },
  CORPSE: { rows: [DEATH_ROW], seconds: Infinity, action: 'none', next: 'CORPSE', sequence: true },
};

export interface EnemyKind {
  health: number;
  /** Tiles per second. */
  speed: number;
  radius: number;
  worldHeight: number;
  damage: number;
  meleeRange: number;
  /** 0-1: chance of flinching into PAIN when hurt, DOOM's `painchance`. */
  painChance: number;
  /** Seconds before a woken enemy starts moving. */
  reactionTime: number;
  sightRange: number;
}

export const GRUNT: EnemyKind = {
  health: 20,
  speed: 1.5,
  radius: 0.34,
  worldHeight: 0.62,
  damage: 8,
  meleeRange: 0.95,
  painChance: 0.75,
  reactionTime: 0.7,
  sightRange: 14,
};

export const BOSS: EnemyKind = {
  health: 400,
  speed: 2.3,
  radius: 0.62,
  worldHeight: 1.35,
  damage: 16,
  meleeRange: 1.5,
  painChance: 0.18,
  reactionTime: 0.35,
  sightRange: 24,
};

/** The eight directions a DOOM monster may walk in; it never moves at any other angle. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.7071, -0.7071],
  [0, -1],
  [-0.7071, -0.7071],
  [-1, 0],
  [-0.7071, 0.7071],
  [0, 1],
  [0.7071, 0.7071],
];
const NO_DIR = -1;

export interface World {
  grid: string[];
  playerX: number;
  playerY: number;
  /** Returns true if the hit landed; lets the caller own player health. */
  hurtPlayer(amount: number): void;
  onWake?(): void;
}

export class Enemy {
  x: number;
  y: number;
  angle = 0;
  health: number;
  state: StateName = 'IDLE';
  frame = 0;
  flash = 0;

  private timer = 0;
  private awake = false;
  private reaction = 0;
  private moveDir = NO_DIR;
  private moveCount = 0;
  private struck = false;

  constructor(
    readonly kind: EnemyKind,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
    this.health = kind.health;
  }

  get dead(): boolean {
    return this.state === 'DEATH' || this.state === 'CORPSE';
  }

  /** Solid only while alive, exactly like DOOM clearing MF_SOLID in A_Fall. */
  get solid(): boolean {
    return !this.dead;
  }

  get currentState(): StateDef {
    return STATES[this.state];
  }

  get sequenceFrame(): boolean {
    return this.currentState.sequence === true;
  }

  /** The atlas row this enemy is drawing right now. */
  get row(): number {
    const rows = this.currentState.rows;
    return rows[Math.min(this.frame, rows.length - 1)]!;
  }

  setState(name: StateName): void {
    this.state = name;
    this.frame = 0;
    this.timer = 0;
    if (name === 'STRIKE') this.struck = false;
  }

  wake(world: World): void {
    if (this.awake || this.dead) return;
    this.awake = true;
    this.reaction = this.kind.reactionTime;
    this.setState('CHASE');
    world.onWake?.();
  }

  hurt(amount: number, world: World): void {
    if (this.dead) return;
    this.health -= amount;
    this.flash = 140;
    // Being shot wakes you and makes the shooter your problem — P_DamageMobj.
    this.wake(world);
    if (this.health <= 0) {
      this.setState('DEATH');
      return;
    }
    if (this.state !== 'WINDUP' && this.state !== 'STRIKE' && Math.random() < this.kind.painChance) {
      this.setState('PAIN');
    }
  }

  update(world: World, dt: number, deathFrames: number): void {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 420 * dt);
    if (this.state === 'CORPSE') return;

    if (this.reaction > 0) this.reaction = Math.max(0, this.reaction - dt);

    const def = this.currentState;
    this.timer += dt;
    while (this.timer >= def.seconds) {
      this.timer -= def.seconds;
      const total = def.sequence ? deathFrames : def.rows.length;
      if (this.frame + 1 >= total) {
        if (this.state === 'DEATH') {
          this.frame = total - 1;
          this.setState('CORPSE');
          this.frame = total - 1;
          return;
        }
        this.frame = 0;
        if (STATES[def.next] !== def) this.setState(def.next);
      } else {
        this.frame++;
      }
      if (def.seconds === Infinity) break;
    }

    this.act(def.action, world, dt);
  }

  private act(action: Action, world: World, dt: number): void {
    switch (action) {
      case 'look':
        if (this.canSee(world)) this.wake(world);
        break;
      case 'chase':
        this.chase(world, dt);
        break;
      case 'face':
        this.faceTarget(world);
        break;
      case 'strike':
        // Damage lands on the strike frame only, so backing off mid-swing works.
        if (!this.struck) {
          this.struck = true;
          if (this.distanceToPlayer(world) <= this.kind.meleeRange + 0.25) {
            world.hurtPlayer(this.kind.damage);
          }
        }
        break;
      case 'none':
        break;
    }
  }

  private distanceToPlayer(world: World): number {
    return Math.hypot(world.playerX - this.x, world.playerY - this.y);
  }

  private canSee(world: World): boolean {
    if (this.distanceToPlayer(world) > this.kind.sightRange) return false;
    return hasLineOfSight(world.grid, this.x, this.y, world.playerX, world.playerY);
  }

  private faceTarget(world: World): void {
    this.angle = Math.atan2(-(world.playerY - this.y), world.playerX - this.x);
  }

  private chase(world: World, dt: number): void {
    if (this.reaction > 0) return;
    this.faceTarget(world);

    if (
      this.distanceToPlayer(world) <= this.kind.meleeRange &&
      hasLineOfSight(world.grid, this.x, this.y, world.playerX, world.playerY)
    ) {
      this.setState('WINDUP');
      return;
    }

    this.moveCount -= dt;
    if (this.moveDir === NO_DIR || this.moveCount <= 0) this.newChaseDir(world);

    if (this.moveDir !== NO_DIR && !this.step(world, this.moveDir, dt)) {
      this.newChaseDir(world);
      if (this.moveDir !== NO_DIR) this.step(world, this.moveDir, dt);
    }
  }

  /**
   * P_NewChaseDir: head for the player, preferring the diagonal, falling back to each
   * axis, then to anything walkable, then to a reversal. `moveCount` forces a fresh
   * decision every so often so a monster cannot grind against a corner forever.
   */
  private newChaseDir(world: World): void {
    const dx = world.playerX - this.x;
    const dy = world.playerY - this.y;
    const horizontal = dx > 0.2 ? 0 : dx < -0.2 ? 4 : NO_DIR;
    const vertical = dy > 0.2 ? 6 : dy < -0.2 ? 2 : NO_DIR;

    const candidates: number[] = [];
    if (horizontal !== NO_DIR && vertical !== NO_DIR) {
      candidates.push(diagonalBetween(horizontal, vertical));
    }
    // Try the longer axis first, which is what makes them look purposeful.
    if (Math.abs(dx) > Math.abs(dy)) candidates.push(horizontal, vertical);
    else candidates.push(vertical, horizontal);

    for (let i = 0; i < DIRECTIONS.length; i++) candidates.push(i);

    for (const dir of candidates) {
      if (dir === NO_DIR || dir === undefined) continue;
      if (this.canStep(world, dir, 0.32)) {
        this.moveDir = dir;
        this.moveCount = 0.4 + Math.random() * 0.8;
        return;
      }
    }
    this.moveDir = NO_DIR;
  }

  private canStep(world: World, dir: number, distance: number): boolean {
    const [dx, dy] = DIRECTIONS[dir]!;
    return this.free(world.grid, this.x + dx * distance, this.y + dy * distance);
  }

  private step(world: World, dir: number, dt: number): boolean {
    const [dx, dy] = DIRECTIONS[dir]!;
    const distance = this.kind.speed * dt;
    const nx = this.x + dx * distance;
    const ny = this.y + dy * distance;
    let moved = false;
    if (this.free(world.grid, nx, this.y)) {
      this.x = nx;
      moved = true;
    }
    if (this.free(world.grid, this.x, ny)) {
      this.y = ny;
      moved = true;
    }
    return moved;
  }

  private free(grid: string[], x: number, y: number): boolean {
    const r = this.kind.radius;
    return (
      !isWall(grid, Math.floor(x + r), Math.floor(y + r)) &&
      !isWall(grid, Math.floor(x - r), Math.floor(y + r)) &&
      !isWall(grid, Math.floor(x + r), Math.floor(y - r)) &&
      !isWall(grid, Math.floor(x - r), Math.floor(y - r))
    );
  }
}

/** The diagonal sitting between an east/west index and a north/south index. */
function diagonalBetween(horizontal: number, vertical: number): number {
  if (horizontal === 0) return vertical === 2 ? 1 : 7;
  return vertical === 2 ? 3 : 5;
}
