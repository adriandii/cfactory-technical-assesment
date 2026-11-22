import type { Logger } from '../application/ports.js';

/** Runs `close` once on SIGINT/SIGTERM, then exits. A second signal exits immediately. */
export function onShutdown(log: Logger, close: () => Promise<void>): void {
  let closing = false;
  const handle = (signal: NodeJS.Signals) => {
    if (closing) process.exit(1);
    closing = true;
    log.info('shutting down', { signal });
    close().then(
      () => process.exit(0),
      (error: unknown) => {
        log.error('shutdown failed', { error });
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}
