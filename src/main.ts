import './style.css';

import { Display } from './engine/framebuffer';
import { Input } from './engine/input';
import { ejectFromWall, Player } from './engine/player';
import { renderScene, type WallTextures } from './engine/raycaster';
import { solidTexture, TextureStore } from './engine/textures';
import { parseCub, type CubLevel } from './format/cub';
import { SANDBOX_CUB } from './game/levels';

type Mode = 'CURTAIN' | 'PLAYING' | 'MAP_EDITOR' | 'COLOR_EDITOR';

const MAX_DELTA = 0.1;
const PITCH_LIMIT = 0.42;

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const curtain = document.querySelector<HTMLDivElement>('#curtain')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const touch = document.querySelector<HTMLDivElement>('#touch')!;
const stats = document.querySelector<HTMLDivElement>('#stats')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;

const isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;

class Game {
  readonly display: Display;
  readonly input: Input;
  readonly player = new Player();
  readonly store = new TextureStore();

  level: CubLevel;
  mode: Mode = 'CURTAIN';

  private last = 0;
  private frames = 0;
  private fpsClock = 0;
  private fps = 0;

  constructor(level: CubLevel) {
    this.level = level;
    this.display = new Display(canvas, isTouchDevice ? 1 : LADDER_START);
    this.input = new Input(canvas, (key) => this.onCommand(key));
    this.player.setAspect(this.display.surface.width, this.display.surface.height);
    this.player.spawn(level.spawn.x, level.spawn.y, level.spawn.facing);

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private onPointerLockChange = (): void => {
    // Losing the lock is the authoritative signal that play has stopped: Esc, a
    // tab switch and the browser's own escape hatch all arrive this way.
    if (!this.input.pointerLocked && this.mode === 'PLAYING' && !isTouchDevice) {
      this.setMode('CURTAIN');
    }
  };

  private onCommand(key: string): void {
    if (key === 'escape') {
      if (this.mode === 'PLAYING') this.input.exitPointerLock();
      else if (this.mode !== 'CURTAIN') this.setMode('PLAYING');
      return;
    }
    if (this.mode === 'PLAYING') {
      if (key === 'm') this.setMode('MAP_EDITOR');
      if (key === 'c') this.setMode('COLOR_EDITOR');
    }
  }

  private listeners: Array<(mode: Mode) => void> = [];

  onModeChange(listener: (mode: Mode) => void): void {
    this.listeners.push(listener);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    const playing = mode === 'PLAYING';
    this.input.enabled = playing;
    curtain.hidden = mode !== 'CURTAIN';
    hud.hidden = !playing;
    touch.hidden = !playing || !isTouchDevice;

    if (playing && !isTouchDevice) this.input.requestPointerLock();
    if (!playing) this.input.exitPointerLock();

    for (const listener of this.listeners) listener(mode);
  }

  /** Applies an edited level: reload textures, keep the player, dig them out if buried. */
  async applyLevel(level: CubLevel, respawn = false): Promise<void> {
    this.level = level;
    await this.loadTextures();
    if (respawn) this.player.spawn(level.spawn.x, level.spawn.y, level.spawn.facing);
    else ejectFromWall(level.grid, this.player);
  }

  async loadTextures(): Promise<void> {
    const paths = new Set(Object.values(this.level.textures));
    await Promise.all(
      [...paths].map(async (path) => {
        if (this.store.has(path)) return;
        try {
          await this.store.load(path, path.replace(/^\.\//, '/'));
        } catch {
          // A path with no image behind it renders as flat grey rather than failing
          // the level — the colour editor is where the player fixes it.
          this.store.set(path, solidTexture(0x8892a0));
        }
      }),
    );
  }

  private walls(): WallTextures {
    const { textures } = this.level;
    return {
      NO: this.store.get(textures.NO),
      SO: this.store.get(textures.SO),
      WE: this.store.get(textures.WE),
      EA: this.store.get(textures.EA),
    };
  }

  frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const started = performance.now();
    // A backgrounded tab returns one enormous delta; uncapped it teleports the
    // player through a wall on resume.
    const dt = Math.min((now - this.last) / 1000, MAX_DELTA);
    this.last = now;

    if (this.mode === 'PLAYING') {
      const look = this.input.consumeLook();
      if (look.yaw !== 0) this.player.rotate(-look.yaw);
      if (look.pitch !== 0) {
        const limit = this.display.surface.height * PITCH_LIMIT;
        this.player.pitch = Math.min(Math.max(this.player.pitch - look.pitch, -limit), limit);
      }
      this.player.update(this.input.readIntent(), this.level.grid, dt);
    }

    if (this.mode !== 'MAP_EDITOR' && this.mode !== 'COLOR_EDITOR') {
      renderScene(
        this.display.surface,
        this.level.grid,
        this.player,
        this.walls(),
        this.level.ceiling,
        this.level.floor,
      );
      this.display.present();
    }

    const elapsed = performance.now() - started;
    this.display.sample(elapsed, now);

    this.frames++;
    if (now - this.fpsClock >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsClock));
      this.frames = 0;
      this.fpsClock = now;
      const { width, height } = this.display.surface;
      stats.textContent = `${this.fps} fps · ${width}x${height}`;
    }
  };
}

const LADDER_START = 3;

async function boot(): Promise<void> {
  const parsed = parseCub(SANDBOX_CUB);
  if (!parsed.ok) {
    throw new Error(`built-in level is invalid: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  const game = new Game(parsed.level);
  await game.loadTextures();
  // Handle for scripts/smoke.mjs, which drives the real page in a browser.
  (globalThis as Record<string, unknown>).__cub3d = game;

  const { mountMapEditor } = await import('./editor/mapEditor');
  const { mountColorEditor } = await import('./editor/colorEditor');
  mountMapEditor(game);
  mountColorEditor(game);

  startButton.addEventListener('click', () => game.setMode('PLAYING'));
  canvas.addEventListener('click', () => {
    if (game.mode === 'CURTAIN') game.setMode('PLAYING');
  });
  document.querySelector('#touch-map')!.addEventListener('click', () => game.setMode('MAP_EDITOR'));
  document
    .querySelector('#touch-colour')!
    .addEventListener('click', () => game.setMode('COLOR_EDITOR'));

  requestAnimationFrame(game.frame);
}

export type { Game };

void boot();
