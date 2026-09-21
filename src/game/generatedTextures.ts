/** Textures drawn at load time rather than shipped as files: the door and the pickups. */

import type { Texture } from '../engine/textures';

function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint32Array(image.data.buffer) };
}

export function doorTexture(): Texture {
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#1b1410';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2e2119';
    ctx.fillRect(6, 6, 116, 116);

    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 108, 108);
    for (let y = 22; y < 118; y += 24) {
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(116, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#0c0a08';
    ctx.fillRect(16, 40, 96, 34);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 21px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('THE', 64, 50);
    ctx.fillText('END', 64, 66);

    ctx.fillStyle = '#c0872f';
    ctx.fillRect(100, 84, 8, 8);
  });
}

export function pickupTexture(kind: 'health' | 'ammo'): Texture {
  return paint(32, 32, (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    if (kind === 'health') {
      ctx.fillStyle = '#e8e8ea';
      ctx.fillRect(4, 8, 24, 18);
      ctx.fillStyle = '#d63b3b';
      ctx.fillRect(14, 12, 4, 10);
      ctx.fillRect(10, 16, 12, 4);
      ctx.strokeStyle = '#8d9096';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 8, 24, 18);
    } else {
      ctx.fillStyle = '#5a4a24';
      ctx.fillRect(5, 12, 22, 14);
      ctx.fillStyle = '#d8b03a';
      for (let i = 0; i < 4; i++) ctx.fillRect(7 + i * 5, 6, 3, 8);
      ctx.strokeStyle = '#2e2612';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 12, 22, 14);
    }
  });
}
