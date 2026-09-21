/**
 * Billboard rendering — the one part of the engine with no counterpart in the C,
 * which draws only walls and a fixed HUD gun.
 *
 * Each sprite is transformed by the inverse camera matrix, which gives its depth and
 * its horizontal screen position directly, then drawn column by column against the
 * z-buffer the raycaster filled. That per-column test is our equivalent of DOOM
 * clipping its vissprites against the solid wall segments.
 */

import type { Surface } from './framebuffer';
import type { Player } from './player';
import type { Texture } from './textures';

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Billboard {
  /** World position, in tiles. */
  x: number;
  y: number;
  texture: Texture;
  frame: AtlasFrame;
  /** Height in tiles; width follows from the frame's aspect so nothing stretches. */
  worldHeight: number;
  mirrored: boolean;
  /** 0-255 added to every channel, for a hit flash. */
  flash?: number;
  /** Lifts the sprite off the floor, in tiles — used by projectiles. */
  lift?: number;
}

const FOG = 0.15;

/**
 * Screen-space blit for the HUD weapon — no depth, no perspective, nearest-neighbour.
 * The same job draw_xpm() does in the C bonus, minus its single magic-colour key.
 */
export function blitScaled(
  surface: Surface,
  texture: Texture,
  dstX: number,
  dstY: number,
  scale: number,
): void {
  const { width, height, data } = surface;
  const drawWidth = Math.round(texture.width * scale);
  const drawHeight = Math.round(texture.height * scale);
  const startX = Math.max(dstX, 0);
  const startY = Math.max(dstY, 0);
  const endX = Math.min(dstX + drawWidth, width);
  const endY = Math.min(dstY + drawHeight, height);

  for (let y = startY; y < endY; y++) {
    const row = Math.min(texture.height - 1, Math.floor(((y - dstY) / drawHeight) * texture.height));
    let offset = y * width + startX;
    for (let x = startX; x < endX; x++) {
      const column = Math.min(
        texture.width - 1,
        Math.floor(((x - dstX) / drawWidth) * texture.width),
      );
      const texel = texture.data[row * texture.width + column]!;
      if (texel >>> 24 >= 128) data[offset] = texel;
      offset++;
    }
  }
}

/**
 * DOOM's rule: the angle from the actor to the viewer, relative to the way the actor
 * faces, split into eight 45-degree sectors. Five drawn columns cover it because the
 * three side-on views mirror.
 */
export function rotationFrame(
  actorAngle: number,
  actorX: number,
  actorY: number,
  viewerX: number,
  viewerY: number,
  columns: number,
): { column: number; mirrored: boolean } {
  const toViewer = Math.atan2(-(viewerY - actorY), viewerX - actorX);
  const twoPi = Math.PI * 2;
  let relative = (toViewer - actorAngle + Math.PI / 8) % twoPi;
  if (relative < 0) relative += twoPi;
  const sector = Math.floor(relative / (Math.PI / 4)) % 8;
  const last = columns - 1;
  return sector <= last
    ? { column: sector, mirrored: false }
    : { column: 8 - sector, mirrored: true };
}

export function drawSprites(surface: Surface, player: Player, sprites: Billboard[]): void {
  if (sprites.length === 0) return;

  const { width, height, data, zbuffer } = surface;
  const { x: posX, y: posY, dirX, dirY, planeX, planeY } = player;
  const horizon = height / 2 + player.pitch;

  const determinant = planeX * dirY - dirX * planeY;
  if (determinant === 0) return;
  const invDet = 1 / determinant;

  // Painter's algorithm for the sprites among themselves; the z-buffer handles walls.
  const ordered = sprites
    .map((sprite) => {
      const relX = sprite.x - posX;
      const relY = sprite.y - posY;
      return {
        sprite,
        cameraX: invDet * (dirY * relX - dirX * relY),
        depth: invDet * (-planeY * relX + planeX * relY),
      };
    })
    .filter((s) => s.depth > 0.08)
    .sort((a, b) => b.depth - a.depth);

  for (const { sprite, cameraX, depth } of ordered) {
    const { frame, texture } = sprite;
    // Pixels per world unit at this depth — the same scale the walls use, so a
    // sprite one tile tall exactly matches a wall's height beside it.
    const scale = height / depth;
    const bottom = horizon + scale / 2 - (sprite.lift ?? 0) * scale;
    const spriteHeight = sprite.worldHeight * scale;
    const top = bottom - spriteHeight;
    const spriteWidth = spriteHeight * (frame.w / frame.h);
    const centre = (width / 2) * (1 + cameraX / depth);

    const left = Math.floor(centre - spriteWidth / 2);
    const startX = Math.max(left, 0);
    const endX = Math.min(Math.ceil(centre + spriteWidth / 2), width);
    const startY = Math.max(Math.floor(top), 0);
    const endY = Math.min(Math.ceil(bottom), height);
    if (startX >= endX || startY >= endY) continue;

    const shade = Math.min(256, Math.round(256 / (1 + depth * FOG)));
    const flash = sprite.flash ?? 0;
    const texData = texture.data;
    const texWidth = texture.width;

    for (let x = startX; x < endX; x++) {
      if (depth >= zbuffer[x]!) continue;

      let column = Math.floor(((x - left) / spriteWidth) * frame.w);
      if (sprite.mirrored) column = frame.w - 1 - column;
      column = Math.min(Math.max(column, 0), frame.w - 1);
      const texColumn = frame.x + column;

      let lastRow = -1;
      let colour = 0;
      let transparent = false;
      let offset = startY * width + x;

      for (let y = startY; y < endY; y++) {
        // Clamp before the cache comparison, not after: startY floors `top`, so the
        // first scanline can land on row -1 and match the initial lastRow, skipping
        // the sample and painting a stripe of uninitialised colour across the sprite.
        const row = Math.min(
          Math.max(Math.floor(((y - top) / spriteHeight) * frame.h), 0),
          frame.h - 1,
        );
        if (row !== lastRow) {
          lastRow = row;
          const texel = texData[(frame.y + row) * texWidth + texColumn]!;
          transparent = (texel >>> 24) < 128;
          if (!transparent) {
            const r = Math.min(255, (((texel & 0xff) * shade) >> 8) + flash);
            const g = Math.min(255, ((((texel >> 8) & 0xff) * shade) >> 8) + flash);
            const b = Math.min(255, ((((texel >> 16) & 0xff) * shade) >> 8) + flash);
            colour = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
          }
        }
        if (!transparent) data[offset] = colour;
        offset += width;
      }
    }
  }
}
