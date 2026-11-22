import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayError, type JobGateway } from '../application/job-gateway';
import { InvalidFileError, submitImage } from '../application/submit-image';
import { trackJob } from '../application/track-job';
import type { Job } from '../domain/job';

export type ImageJobState =
  | { phase: 'idle'; error?: string }
  | { phase: 'uploading'; fileName: string }
  | { phase: 'tracking'; fileName: string; job: Job; error?: string };

/** Drives one upload: submit, then poll until the job finishes. Starting again cancels the previous run. */
export function useImageJob(gateway: JobGateway) {
  const [state, setState] = useState<ImageJobState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const upload = useCallback(
    async (file: File) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const fileName = file.name;

      setState({ phase: 'uploading', fileName });
      try {
        const job = await submitImage(gateway, file, controller.signal);
        setState({ phase: 'tracking', fileName, job });
        await trackJob(gateway, job, {
          signal: controller.signal,
          onUpdate: (next) => setState({ phase: 'tracking', fileName, job: next }),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = describeError(error);
        setState((prev) => (prev.phase === 'tracking' ? { ...prev, error: message } : { phase: 'idle', error: message }));
      }
    },
    [gateway],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ phase: 'idle' });
  }, []);

  return { state, upload, reset };
}

function describeError(error: unknown): string {
  if (error instanceof InvalidFileError || error instanceof GatewayError) return error.message;
  console.error(error);
  return 'Something went wrong. Try again.';
}
