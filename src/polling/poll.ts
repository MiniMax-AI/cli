import type { Config } from '../config/schema';
import { requestJson } from '../client/http';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { createSpinner } from '../output/progress';

export interface PollOptions {
  url: string;
  intervalSec: number;
  timeoutSec: number;
  isComplete: (data: unknown) => boolean;
  isFailed: (data: unknown) => boolean;
  getStatus?: (data: unknown) => string;
  getFailureReason?: (data: unknown) => string | undefined;
}

export async function poll<T>(config: Config, opts: PollOptions): Promise<T> {
  const deadline = Date.now() + opts.timeoutSec * 1000;
  const spinner = createSpinner('Polling...');

  if (!config.quiet) spinner.start();

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      // Cap the HTTP wait by the polling budget remaining at this point,
      // without increasing a shorter configured per-request timeout.
      const timeout = Math.min(config.timeout, remainingMs / 1000);
      const data = await requestJson<T>(config, { url: opts.url, timeout });

      if (opts.getStatus && !config.quiet) {
        spinner.update(`Status: ${opts.getStatus(data)}`);
      }

      if (opts.isComplete(data)) {
        spinner.stop('Done.');
        return data;
      }

      if (opts.isFailed(data)) {
        spinner.stop('Failed.');
        // Include API status context to help users diagnose failures
        const status = opts.getStatus ? opts.getStatus(data) : 'failed';
        const baseResponseMessage = (
          data as { base_resp?: { status_msg?: string } }
        ).base_resp?.status_msg;
        const failureReason = opts.getFailureReason?.(data) ?? baseResponseMessage;
        const extra = failureReason ? ` (${failureReason})` : '';
        throw new CLIError(
          `Task ${status}.${extra}`,
          ExitCode.GENERAL,
          'Check the MiniMax dashboard or --verbose output for details.',
        );
      }

      await new Promise(r => setTimeout(r, Math.min(opts.intervalSec * 1000, Math.max(0, deadline - Date.now()))));
    }
  } finally {
    spinner.stop();
  }

  throw new CLIError(
    'Polling timed out.',
    ExitCode.TIMEOUT,
    'Try increasing --timeout or check task status manually.',
  );
}
