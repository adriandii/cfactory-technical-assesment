import { describe, expect, it, vi } from 'vitest';
import type { Job } from '../domain/job';
import { GatewayError, type JobGateway } from './job-gateway';
import { backoffDelay, DEFAULT_POLL_POLICY, trackJob, type PollPolicy } from './track-job';

const pending: Job = { id: 'job-1', status: 'pending' };
const processing: Job = { id: 'job-1', status: 'processing' };
const completed: Job = { id: 'job-1', status: 'completed', downloadUrl: '/api/jobs/job-1/download' };
const offline = new GatewayError('Cannot reach the server.', true);

/** Gateway whose get() answers with the scripted responses, in order. */
function scriptedGateway(...responses: Array<Job | Error>) {
  const get = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('no scripted response left');
    if (next instanceof Error) throw next;
    return next;
  });
  return { submit: vi.fn(), get } satisfies JobGateway;
}

/** Runs trackJob with an instant sleep that records each requested delay. */
function track(gateway: JobGateway, policy: PollPolicy = DEFAULT_POLL_POLICY) {
  const delays: number[] = [];
  const updates: string[] = [];
  const result = trackJob(gateway, pending, {
    policy,
    onUpdate: (job) => updates.push(job.status),
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { result, delays, updates };
}

describe('backoffDelay', () => {
  it('grows exponentially up to the cap', () => {
    expect([0, 1, 2, 3, 20].map((n) => backoffDelay(n, DEFAULT_POLL_POLICY))).toEqual([500, 750, 1125, 1687.5, 5000]);
  });
});

describe('trackJob', () => {
  it('polls until the job completes and reports each status change once', async () => {
    const { result, updates } = track(scriptedGateway(pending, processing, processing, completed));

    await expect(result).resolves.toEqual(completed);
    expect(updates).toEqual(['processing', 'completed']);
  });

  it('backs off while the status is unchanged and resets the delay when it changes', async () => {
    const { result, delays } = track(scriptedGateway(pending, pending, processing, processing, completed));

    await result;
    expect(delays).toEqual([500, 750, 1125, 500, 750]);
  });

  it('keeps polling through transient errors', async () => {
    const { result } = track(scriptedGateway(offline, offline, completed));

    await expect(result).resolves.toEqual(completed);
  });

  it('gives up after too many consecutive transient errors', async () => {
    const { result } = track(scriptedGateway(offline, offline, offline), { ...DEFAULT_POLL_POLICY, maxRetries: 2 });

    await expect(result).rejects.toBe(offline);
  });

  it('fails fast on errors that are not retryable', async () => {
    const notFound = new GatewayError('Job not found.', false);
    const gateway = scriptedGateway(notFound, completed);

    await expect(track(gateway).result).rejects.toBe(notFound);
    expect(gateway.get).toHaveBeenCalledTimes(1);
  });

  it('stops waiting as soon as it is aborted', async () => {
    const controller = new AbortController();
    const gateway = scriptedGateway(completed);
    const result = trackJob(gateway, pending, { onUpdate: () => {}, signal: controller.signal });

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(gateway.get).not.toHaveBeenCalled();
  });
});
