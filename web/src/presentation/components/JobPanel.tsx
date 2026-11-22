import { useEffect, useRef } from 'react';
import type { Job } from '../../domain/job';
import type { ImageJobState } from '../use-image-job';
import { AlertIcon, CheckIcon, DownloadIcon } from './icons';

type ActiveState = Exclude<ImageJobState, { phase: 'idle' }>;

interface JobPanelProps {
  state: ActiveState;
  onReset: () => void;
}

export function JobPanel({ state, onReset }: JobPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The dropzone that had focus is gone; move focus here so keyboard and screen reader users follow along.
  useEffect(() => headingRef.current?.focus(), []);

  const job = state.phase === 'tracking' ? state.job : undefined;
  const error = state.phase === 'tracking' ? state.error : undefined;
  const status = describeStatus(job, error);
  const stopped = error !== undefined || job?.status === 'completed' || job?.status === 'failed';

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 ref={headingRef} tabIndex={-1}>
          {state.fileName}
        </h2>
        <p className="job-id">
          <span>Job ID</span>
          {job ? <code>{job.id}</code> : <span>assigned once the upload finishes</span>}
        </p>
      </header>

      <Steps job={job} live={!stopped} />

      <p className="message" data-tone={status.tone} role="status">
        {status.tone === 'success' && <CheckIcon />}
        {status.tone === 'error' && <AlertIcon />}
        <span>
          {status.lead && <strong>{status.lead} </strong>}
          {status.text}
        </span>
      </p>

      {stopped && (
        <div className="actions">
          {job?.status === 'completed' && (
            <a className="button button-primary" href={job.downloadUrl} download={toWebpName(state.fileName)}>
              <DownloadIcon />
              Download WebP
            </a>
          )}
          <button type="button" className="button button-secondary" onClick={onReset}>
            {job?.status === 'completed' ? 'Convert another image' : 'Try another image'}
          </button>
        </div>
      )}
    </section>
  );
}

type StepState = 'todo' | 'active' | 'done' | 'failed';

/** Upload, then the job lifecycle: pending, processing, completed or failed. */
function Steps({ job, live }: { job: Job | undefined; live: boolean }) {
  const current = !job ? 0 : job.status === 'pending' ? 1 : job.status === 'processing' ? 2 : 3;
  const failed = job?.status === 'failed';
  const labels = ['Upload', 'Pending', 'Processing', failed ? 'Failed' : 'Completed'];

  return (
    <ol className="steps">
      {labels.map((label, index) => {
        const stepState: StepState =
          index < current ? 'done' : index > current ? 'todo' : index < 3 ? 'active' : failed ? 'failed' : 'done';
        return (
          <li
            key={label}
            className="step"
            data-state={stepState}
            data-live={(stepState === 'active' && live) || undefined}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="step-dot" />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

interface StatusMessage {
  tone: 'progress' | 'success' | 'error';
  lead?: string;
  text: string;
}

function describeStatus(job: Job | undefined, error: string | undefined): StatusMessage {
  if (error) return { tone: 'error', lead: 'Lost track of this job.', text: error };
  switch (job?.status) {
    case undefined:
      return { tone: 'progress', text: 'Uploading…' };
    case 'pending':
      return { tone: 'progress', text: 'Queued. A worker will pick it up shortly.' };
    case 'processing':
      return { tone: 'progress', text: 'Resizing to 1280 px, compressing at 80% quality and converting to WebP…' };
    case 'completed':
      return { tone: 'success', text: 'Done. Your WebP image is ready.' };
    case 'failed':
      return { tone: 'error', lead: 'Processing failed.', text: job.error };
  }
}

function toWebpName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, '')}.webp`;
}
