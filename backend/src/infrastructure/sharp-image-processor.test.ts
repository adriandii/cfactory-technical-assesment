import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { UnprocessableImageError } from '../application/errors.js';
import { SharpImageProcessor } from './sharp-image-processor.js';

const processor = new SharpImageProcessor();
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#2a9d8f' } });
const sizeOf = async (image: Uint8Array) => {
  const { format, width, height } = await sharp(image).metadata();
  return { format, width, height };
};

describe('SharpImageProcessor', () => {
  it('fits a large landscape image inside 1280px, keeping its aspect ratio, as WebP', async () => {
    const output = await processor.toWebp(await solid(3000, 2000).png().toBuffer());
    expect(await sizeOf(output)).toEqual({ format: 'webp', width: 1280, height: 853 });
  });

  it('fits a portrait image by its height', async () => {
    const output = await processor.toWebp(await solid(1000, 4000).jpeg().toBuffer());
    expect(await sizeOf(output)).toEqual({ format: 'webp', width: 320, height: 1280 });
  });

  it('never enlarges a small image', async () => {
    const output = await processor.toWebp(await solid(800, 600).webp().toBuffer());
    expect(await sizeOf(output)).toEqual({ format: 'webp', width: 800, height: 600 });
  });

  it('applies EXIF orientation before measuring the longest side', async () => {
    // Stored as 2000x1000 but tagged "rotate 90°", so viewers see a 1000x2000 portrait.
    const input = await solid(2000, 1000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await sizeOf(await processor.toWebp(input))).toEqual({ format: 'webp', width: 640, height: 1280 });
  });

  it('rejects bytes that only look like an image', async () => {
    const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    await expect(processor.toWebp(corrupt)).rejects.toMatchObject({
      name: 'UnprocessableImageError',
      message: expect.stringMatching(/could not be decoded/),
    });
  });

  it('refuses decompression bombs before decoding them', async () => {
    // A 68-byte file whose header claims 20000 x 20000 pixels.
    const bomb = tinyPngClaiming(20_000, 20_000);
    await expect(processor.toWebp(bomb)).rejects.toThrow(UnprocessableImageError);
    await expect(processor.toWebp(bomb)).rejects.toThrow(/too many pixels/);
  });
});

function tinyPngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(Buffer.alloc(16)); // a few real pixels; the header must claim the rest
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
