import { toScreen } from './framebuffer';

export interface Texture {
  readonly width: number;
  readonly height: number;
  /** 0xAABBGGRR, matching the framebuffer. */
  readonly data: Uint32Array;
}

export function solidTexture(rgb: number): Texture {
  return { width: 1, height: 1, data: new Uint32Array([toScreen(rgb)]) };
}

function fromImage(source: CanvasImageSource, width: number, height: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint32Array(image.data.buffer) };
}

export async function loadTexture(url: string): Promise<Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`texture ${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    return fromImage(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** Used by the colour editor for images the player supplies. */
export async function textureFromBlob(blob: Blob, maxSize = 512): Promise<Texture> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    return fromImage(bitmap, width, height);
  } finally {
    bitmap.close();
  }
}

export class TextureStore {
  private readonly textures = new Map<string, Texture>();
  private readonly fallback = solidTexture(0x808080);

  set(key: string, texture: Texture): void {
    this.textures.set(key, texture);
  }

  has(key: string): boolean {
    return this.textures.has(key);
  }

  get(key: string): Texture {
    return this.textures.get(key) ?? this.fallback;
  }

  async load(key: string, url: string): Promise<void> {
    this.set(key, await loadTexture(url));
  }
}
