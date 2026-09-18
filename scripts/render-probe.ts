/**
 * Renders a frame of the engine outside a browser and writes it as a PPM, so the
 * raycasting geometry can be eyeballed without a display. Run with:
 *
 *     node scripts/render-probe.ts out.ppm [angleDegrees]
 */

import { writeFileSync } from 'node:fs';

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
(globalThis as Record<string, unknown>).ImageData = FakeImageData;

const { renderScene } = await import('../src/engine/raycaster.ts');
const { Player } = await import('../src/engine/player.ts');
const { parseCub } = await import('../src/format/cub.ts');
const { SANDBOX_CUB } = await import('../src/game/levels.ts');
const { toScreen } = await import('../src/engine/framebuffer.ts');

const WIDTH = 480;
const HEIGHT = 270;

/** A checkerboard with a gradient, so texture U and V mapping are both visible. */
function probeTexture(size = 64) {
  const data = new Uint32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0;
      const shade = Math.round((y / size) * 120) + 60;
      const rgb = checker ? (shade << 16) | (shade << 8) | shade : (200 << 16) | (90 << 8) | 40;
      data[y * size + x] = toScreen(rgb);
    }
  }
  // A bright stripe down the left edge of the texture shows which way U runs.
  for (let y = 0; y < size; y++) data[y * size] = toScreen(0x22ff88);
  return { width: size, height: size, data };
}

const parsed = parseCub(SANDBOX_CUB);
if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '));
const level = parsed.level;

const image = new FakeImageData(WIDTH, HEIGHT);
const surface = {
  width: WIDTH,
  height: HEIGHT,
  data: new Uint32Array(image.data.buffer),
  image: image as unknown as ImageData,
  zbuffer: new Float32Array(WIDTH),
};

const player = new Player();
player.setAspect(WIDTH, HEIGHT);
player.spawn(level.spawn.x, level.spawn.y, level.spawn.facing);
const degrees = Number(process.argv[3] ?? 0);
if (degrees) player.rotate((degrees * Math.PI) / 180);

const texture = probeTexture();
renderScene(
  surface,
  level.grid,
  player,
  { NO: texture, SO: texture, WE: texture, EA: texture },
  level.ceiling,
  level.floor,
);

const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  rgb[i * 3] = image.data[i * 4]!;
  rgb[i * 3 + 1] = image.data[i * 4 + 1]!;
  rgb[i * 3 + 2] = image.data[i * 4 + 2]!;
}
writeFileSync(
  process.argv[2] ?? 'probe.ppm',
  Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`), rgb]),
);

const near = surface.zbuffer[WIDTH >> 1]!;
console.log(
  `wrote ${WIDTH}x${HEIGHT}; centre column distance ${near.toFixed(3)} tiles; ` +
    `min ${Math.min(...surface.zbuffer).toFixed(3)} max ${Math.max(...surface.zbuffer).toFixed(3)}`,
);
