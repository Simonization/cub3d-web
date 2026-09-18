/**
 * The framebuffer, and the resolution ladder that keeps it inside the frame budget.
 *
 * Every rung is 16:9 so the camera plane length — and therefore the field of view —
 * never changes when the ladder shifts; the canvas is letterboxed by CSS instead.
 */

export interface Surface {
  readonly width: number;
  readonly height: number;
  /** 0xAABBGGRR, i.e. the little-endian view of ImageData's RGBA bytes. */
  readonly data: Uint32Array;
  readonly image: ImageData;
  /** Perpendicular wall distance per column, for depth-clipping sprites. */
  readonly zbuffer: Float32Array;
}

export const LADDER: ReadonlyArray<readonly [number, number]> = [
  [320, 180],
  [480, 270],
  [640, 360],
  [960, 540],
];

/** Pack a cub3D 0x00RRGGBB colour into the byte order ImageData wants. */
export const toScreen = (rgb: number): number =>
  (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;

function createSurface(width: number, height: number): Surface {
  const image = new ImageData(width, height);
  return {
    width,
    height,
    data: new Uint32Array(image.data.buffer),
    image,
    zbuffer: new Float32Array(width),
  };
}

/** Quick to drop a rung, slow to climb one, so thermal throttling cannot start an oscillation. */
const FRAME_BUDGET_MS = 20;
const COMFORTABLE_MS = 11;
const EVALUATE_EVERY_MS = 1000;
const CLIMB_AFTER_MS = 5000;

export class Display {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly surfaces: Surface[];
  private index: number;
  private samples: number[] = [];
  private lastEvaluated = 0;
  private comfortableSince: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    startIndex = LADDER.length - 1,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    // Pre-allocated so switching rungs is a pointer swap, never an allocation.
    this.surfaces = LADDER.map(([w, h]) => createSurface(w, h));
    this.index = Math.min(Math.max(startIndex, 0), this.surfaces.length - 1);
    this.applySize();
  }

  get surface(): Surface {
    return this.surfaces[this.index]!;
  }

  private applySize(): void {
    const { width, height } = this.surface;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  present(): void {
    this.ctx.putImageData(this.surface.image, 0, 0);
  }

  /** Feed each frame's duration in; the ladder moves at most one rung per second. */
  sample(frameMs: number, now: number): void {
    this.samples.push(frameMs);
    if (now - this.lastEvaluated < EVALUATE_EVERY_MS) return;
    this.lastEvaluated = now;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    this.samples = [];

    if (median > FRAME_BUDGET_MS && this.index > 0) {
      this.index--;
      this.comfortableSince = null;
      this.applySize();
      return;
    }
    if (median < COMFORTABLE_MS && this.index < this.surfaces.length - 1) {
      this.comfortableSince ??= now;
      if (now - this.comfortableSince >= CLIMB_AFTER_MS) {
        this.index++;
        this.comfortableSince = null;
        this.applySize();
      }
      return;
    }
    this.comfortableSince = null;
  }
}

/**
 * Fill the ceiling and floor in one pass each. Rows are contiguous in the buffer,
 * so this is a memset rather than a per-pixel loop; the wall spans overwrite it.
 */
export function fillBackground(surface: Surface, horizon: number, ceiling: number, floor: number): void {
  const { data, width, height } = surface;
  const split = Math.min(Math.max(Math.round(horizon), 0), height);
  data.fill(toScreen(ceiling), 0, split * width);
  data.fill(toScreen(floor), split * width, height * width);
}
