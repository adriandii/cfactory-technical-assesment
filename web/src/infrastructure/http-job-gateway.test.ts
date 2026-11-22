import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpJobGateway } from './http-job-gateway';

const gateway = new HttpJobGateway('/api');
const photo = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

/** Replaces global fetch with one that answers every call with this status and JSON body. */
function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpJobGateway', () => {
  it('uploads the file as multipart form data and maps the pending job', async () => {
    const fetchMock = respondWith(202, { job_id: 'abc', status: 'pending' });

    await expect(gateway.submit(photo)).resolves.toEqual({ id: 'abc', status: 'pending' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/jobs');
    expect(init?.method).toBe('POST');
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('gives completed jobs a download URL', async () => {
    respondWith(200, { job_id: 'abc', status: 'completed' });

    await expect(gateway.get('abc')).resolves.toEqual({
      id: 'abc',
      status: 'completed',
      downloadUrl: '/api/jobs/abc/download',
    });
  });

  it('passes the failure reason through for failed jobs', async () => {
    respondWith(200, { job_id: 'abc', status: 'failed', error: 'The file is not a valid image.' });

    await expect(gateway.get('abc')).resolves.toEqual({
      id: 'abc',
      status: 'failed',
      error: 'The file is not a valid image.',
    });
  });

  it('surfaces the server message for client errors and does not retry them', async () => {
    respondWith(413, { error: 'File exceeds the 20 MB limit.' });

    await expect(gateway.submit(photo)).rejects.toMatchObject({
      name: 'GatewayError',
      message: 'File exceeds the 20 MB limit.',
      retryable: false,
    });
  });

  it('marks server errors as retryable, with a fallback message for non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));

    await expect(gateway.get('abc')).rejects.toMatchObject({
      message: 'The server ran into a problem. Try again in a moment.',
      retryable: true,
    });
  });

  it('marks network failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(gateway.get('abc')).rejects.toMatchObject({
      message: 'Cannot reach the server. Check your connection and try again.',
      retryable: true,
    });
  });

  it('rejects responses that do not match the contract', async () => {
    respondWith(200, { id: 'abc', state: 'done' });

    await expect(gateway.get('abc')).rejects.toMatchObject({
      message: 'The server sent an unexpected response.',
      retryable: false,
    });
  });
});
