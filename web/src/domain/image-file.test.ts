import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageFile } from './image-file';

describe('validateImageFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validateImageFile({ type, size: 1024 })).toBeNull();
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', ''])('rejects type "%s"', (type) => {
    expect(validateImageFile({ type, size: 1024 })).toMatch(/JPG, PNG or WebP/);
  });

  it('accepts exactly the size limit and rejects one byte more', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES })).toBeNull();
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatch(/limit is 20 MB/);
  });

  it('rejects empty files', () => {
    expect(validateImageFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});
