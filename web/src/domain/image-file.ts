export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const MAX_IMAGE_MB = 20;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

/** Returns why the file cannot be uploaded, or null when it is acceptable. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Unsupported file type. Choose a JPG, PNG or WebP image.';
  }
  if (file.size === 0) {
    return 'This file is empty. Choose another image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    return `This file is ${sizeMb} MB. The limit is ${MAX_IMAGE_MB} MB.`;
  }
  return null;
}
