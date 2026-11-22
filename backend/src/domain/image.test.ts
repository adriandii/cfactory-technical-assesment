import { describe, expect, it } from 'vitest';
import { detectImageType } from './image.js';

const bytes = (...values: Array<number | string>) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(detectImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png');
    expect(detectImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP', 'VP8 '))).toBe('image/webp');
  });

  it('rejects other formats and truncated headers', () => {
    expect(detectImageType(bytes('GIF89a'))).toBeNull();
    expect(detectImageType(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull(); // RIFF, but audio
    expect(detectImageType(bytes('<svg'))).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});
