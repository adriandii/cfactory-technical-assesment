import type { JobGateway } from '../application/job-gateway';
import { Dropzone } from './components/Dropzone';
import { JobPanel } from './components/JobPanel';
import { useImageJob } from './use-image-job';

export function App({ gateway }: { gateway: JobGateway }) {
  const { state, upload, reset } = useImageJob(gateway);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Convert images to WebP</h1>
        <p>
          Upload a JPG, PNG or WebP image. A background worker resizes it to at most 1280&nbsp;px on the longest side,
          compresses it at 80% quality and converts it to WebP.
        </p>
      </header>

      {state.phase === 'idle' ? (
        <Dropzone onFile={upload} error={state.error} />
      ) : (
        <JobPanel state={state} onReset={reset} />
      )}
    </main>
  );
}
