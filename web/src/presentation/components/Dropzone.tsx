import { useState, type DragEvent } from 'react';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_MB } from '../../domain/image-file';
import { AlertIcon, UploadIcon } from './icons';

interface DropzoneProps {
  onFile: (file: File) => void;
  error?: string;
}

export function Dropzone({ onFile, error }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    setDragging(true);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) onFile(file);
  }

  return (
    <div className="dropzone-wrap">
      <label
        className="dropzone"
        data-dragging={dragging || undefined}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="visually-hidden"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={(event) => {
            const file = event.target.files?.item(0);
            event.target.value = ''; // so choosing the same file again still fires change
            if (file) onFile(file);
          }}
        />
        <UploadIcon className="dropzone-icon" />
        <span className="dropzone-title">
          Drop an image here or <span className="dropzone-browse">browse</span>
        </span>
        <span className="dropzone-hint">JPG, PNG or WebP, up to {MAX_IMAGE_MB} MB</span>
      </label>
      {error && (
        <p className="message" data-tone="error" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
