import { CLIError } from './base';
import { ExitCode } from './codes';
import { detectOutputFormat } from '../output/formatter';

export function handleError(err: unknown): never {
  if (err instanceof CLIError) {
    const format = detectOutputFormat(process.env.MINIMAX_OUTPUT);

    if (format === 'json') {
      process.stderr.write(JSON.stringify(err.toJSON(), null, 2) + '\n');
    } else {
      process.stderr.write(`\nError: ${err.message}\n`);
      if (err.hint) {
        process.stderr.write(`\n  ${err.hint.split('\n').join('\n  ')}\n`);
      }
      process.stderr.write(`  (exit code ${err.exitCode})\n`);
    }
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.includes('timed out')) {
      const timeout = new CLIError(
        'Request timed out.',
        ExitCode.TIMEOUT,
        'Try increasing --timeout or retry later.',
      );
      return handleError(timeout);
    }
    process.stderr.write(`\nError: ${err.message}\n`);
    if (process.env.MINIMAX_VERBOSE === '1') {
      process.stderr.write(`${err.stack}\n`);
    }
  } else {
    process.stderr.write(`\nError: ${String(err)}\n`);
  }

  process.exit(ExitCode.GENERAL);
}
