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
}

export async function poll<T>(config: Config, opts: PollOptions): Promise<T> {
  const deadline = Date.now() + opts.timeoutSec * 1000;
  const spinner = createSpinner('Polling...');

  if (!config.quiet) spinner.start();

  try {
    while (Date.now() < deadline) {
      const data = await requestJson<T>(config, { url: opts.url });

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
        const extra = (data as Record<string, unknown>)?.base_resp
          ? ` (${(data as { base_resp: { status_code?: number; status_msg?: string } }).base_resp.status_msg})`
          : '';
        throw new CLIError(
          `Task ${status}.${extra}`,
          ExitCode.GENERAL,
          'Check the MiniMax dashboard or --verbose output for details.',
        );
      }

      await new Promise(r => setTimeout(r, opts.intervalSec * 1000));
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
