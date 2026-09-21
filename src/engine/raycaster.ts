/**
 * Port of src/draw_ray/draw_ray.c and draw_ray_utils.c.
 *
 * The DDA itself is unchanged. What differs from the C: distances are in tile units
 * throughout, the horizon is H/2 + pitch instead of the hardcoded HEIGHT-360, the
 * per-column distance is kept in a z-buffer the C does not have, and the distance
 * shading is computed once per column rather than once per pixel.
 */

import { isWall } from '../format/cub';
import { fillBackground, type Surface } from './framebuffer';
import type { Player } from './player';
import type { Texture } from './textures';

export interface WallTextures {
  NO: Texture;
  SO: Texture;
  WE: Texture;
  EA: Texture;
}

const MAX_STEPS = 512;
const FOG = 0.15;

export interface Hit {
  distance: number;
  mapX: number;
  mapY: number;
  /** false when the ray crossed an x-gridline (an east/west face), true for y. */
  side: boolean;
}

/** The DDA on its own, for line-of-sight and hitscan tests. */
export function castRay(
  grid: string[],
  posX: number,
  posY: number,
  dirX: number,
  dirY: number,
): Hit {
  let mapX = Math.floor(posX);
  let mapY = Math.floor(posY);
  const deltaX = dirX === 0 ? 1e30 : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? 1e30 : Math.abs(1 / dirY);

  let stepX: number;
  let stepY: number;
  let sideDistX: number;
  let sideDistY: number;

  if (dirX < 0) {
    stepX = -1;
    sideDistX = (posX - mapX) * deltaX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - posX) * deltaX;
  }
  if (dirY < 0) {
    stepY = -1;
    sideDistY = (posY - mapY) * deltaY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - posY) * deltaY;
  }

  let side = false;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaX;
      mapX += stepX;
      side = false;
    } else {
      sideDistY += deltaY;
      mapY += stepY;
      side = true;
    }
    if (isWall(grid, mapX, mapY)) {
      return {
        distance: side ? sideDistY - deltaY : sideDistX - deltaX,
        mapX,
        mapY,
        side,
      };
    }
  }
  return { distance: Infinity, mapX, mapY, side };
}

/** True when nothing solid stands between the two points. */
export function hasLineOfSight(
  grid: string[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return true;
  return castRay(grid, fromX, fromY, dx / length, dy / length).distance >= length;
}

/** Key for the per-tile texture overrides the door uses. */
export const tileKey = (x: number, y: number): string => `${x},${y}`;

export function renderScene(
  surface: Surface,
  grid: string[],
  player: Player,
  textures: WallTextures,
  ceiling: number,
  floor: number,
  overrides?: ReadonlyMap<string, Texture>,
): void {
  const { width, height, data, zbuffer } = surface;
  const horizon = height / 2 + player.pitch;
  fillBackground(surface, horizon, ceiling, floor);

  const { x: posX, y: posY, dirX, dirY, planeX, planeY } = player;

  for (let col = 0; col < width; col++) {
    const cameraX = (2 * col) / width - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;

    const hit = castRay(grid, posX, posY, rayDirX, rayDirY);
    const distance = hit.distance;
    zbuffer[col] = distance;
    if (!Number.isFinite(distance) || distance <= 0) continue;

    // Same face convention as side_wall() in draw_ray_utils.c.
    let texture: Texture;
    if (!hit.side) texture = rayDirX > 0 ? textures.EA : textures.WE;
    else texture = rayDirY > 0 ? textures.SO : textures.NO;
    if (overrides) texture = overrides.get(tileKey(hit.mapX, hit.mapY)) ?? texture;

    let wallX = hit.side ? posX + distance * rayDirX : posY + distance * rayDirY;
    wallX -= Math.floor(wallX);

    let texX = Math.floor(wallX * texture.width);
    if ((!hit.side && rayDirX > 0) || (hit.side && rayDirY < 0)) {
      texX = texture.width - texX - 1;
    }
    texX = Math.min(Math.max(texX, 0), texture.width - 1);

    const lineHeight = height / distance;
    const top = horizon - lineHeight / 2;
    const start = Math.max(Math.ceil(top), 0);
    const end = Math.min(Math.ceil(top + lineHeight), height);
    if (start >= end) continue;

    const texStep = texture.height / lineHeight;
    let texPos = (start - top) * texStep;

    // Hoisted out of the pixel loop: the C recomputes this division per pixel.
    const shade = Math.min(256, Math.round(256 / (1 + distance * FOG)));
    const texRow = texture.data;
    const texWidth = texture.width;
    const texMax = texture.height - 1;

    let lastTexY = -1;
    let colour = 0;
    let offset = start * width + col;

    for (let y = start; y < end; y++) {
      const texY = Math.min(Math.max(texPos | 0, 0), texMax);
      texPos += texStep;
      if (texY !== lastTexY) {
        lastTexY = texY;
        const texel = texRow[texY * texWidth + texX]!;
        if (shade >= 256) {
          colour = texel;
        } else {
          const r = ((texel & 0xff) * shade) >> 8;
          const g = (((texel >> 8) & 0xff) * shade) >> 8;
          const b = (((texel >> 16) & 0xff) * shade) >> 8;
          colour = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
      }
      data[offset] = colour;
      offset += width;
    }
  }
}
