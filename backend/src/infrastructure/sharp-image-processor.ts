import sharp from 'sharp';
import { UnprocessableImageError } from '../application/errors.js';
import type { ImageProcessor } from '../application/ports.js';
import { MAX_INPUT_PIXELS, OUTPUT } from '../domain/image.js';

export class SharpImageProcessor implements ImageProcessor {
  async toWebp(input: Uint8Array): Promise<Uint8Array> {
    try {
      return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // apply EXIF orientation first, so "longest side" is the side people see
        .resize({
          width: OUTPUT.maxDimension,
          height: OUTPUT.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: OUTPUT.quality })
        .toBuffer();
    } catch (error) {
      // Decoding happens here, so sharp errors mean bad input; storage and database errors never pass through.
      throw new UnprocessableImageError(describe(error), { cause: error });
    }
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/pixel limit/i.test(message)) {
    return `The image has too many pixels (the limit is ${MAX_INPUT_PIXELS / 1_000_000} megapixels).`;
  }
  return 'The file could not be decoded as an image. It may be corrupted.';
}
