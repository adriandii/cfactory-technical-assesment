export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const MAX_UPLOAD_MB = 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Decompression-bomb guard: a small file can still decode to a huge bitmap. */
export const MAX_INPUT_PIXELS = 100_000_000;

/**
 * What the worker produces: fit inside 1280x1280 without enlarging, WebP at quality 80.
 * "Compress to 80%" and "convert to WebP" are one encode; two lossy passes would only lose more detail.
 */
export const OUTPUT = {
  maxDimension: 1280,
  quality: 80,
  contentType: 'image/webp',
  extension: 'webp',
} as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identifies the image type from its magic bytes. The client's Content-Type and file name are not trusted. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
