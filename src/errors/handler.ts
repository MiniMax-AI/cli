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

    // Detect TypeError from fetch with invalid URL (e.g., malformed MINIMAX_BASE_URL)
    if (err instanceof TypeError && err.message === 'fetch failed') {
      const networkErr = new CLIError(
        'Network request failed.',
        ExitCode.NETWORK,
        'Check your network connection and proxy settings. Also verify MINIMAX_BASE_URL is a valid URL.',
      );
      return handleError(networkErr);
    }

    // Detect network-level errors (proxy, connection refused, DNS, etc.)
    const msg = err.message.toLowerCase();
    const isNetworkError =
      msg.includes('failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('econnrefused') ||
      msg.includes('connection reset') ||
      msg.includes('econnreset') ||
      msg.includes('network error') ||
      msg.includes('enotfound') ||
      msg.includes('getaddrinfo') ||
      msg.includes('proxy') ||
      msg.includes('socket') ||
      msg.includes('etimedout') ||
      msg.includes('timeout') ||
      msg.includes('eai_AGAIN');

    if (isNetworkError) {
      let hint = 'Check your network connection and proxy settings.';
      if (msg.includes('proxy')) {
        hint = 'Proxy error — check HTTP_PROXY / HTTPS_PROXY environment variables and proxy authentication.';
      }
      const networkErr = new CLIError(
        'Network request failed.',
        ExitCode.NETWORK,
        hint,
      );
      return handleError(networkErr);
    }

    // Detect filesystem-level errors (ENOENT, EACCES, ENOSPC, etc.)
    const ecode = (err as NodeJS.ErrnoException).code;
    if (
      ecode === 'ENOENT' ||
      ecode === 'EACCES' ||
      ecode === 'ENOSPC' ||
      ecode === 'ENOTDIR' ||
      ecode === 'EISDIR' ||
      ecode === 'EPERM' ||
      ecode === 'EBUSY'
    ) {
      let hint = 'Check the file path and permissions.';
      if (ecode === 'ENOENT') hint = 'File or directory not found.';
      if (ecode === 'EACCES' || ecode === 'EPERM') hint = 'Permission denied — check file or directory permissions.';
      if (ecode === 'ENOSPC') hint = 'Disk full — free up space and try again.';
      const fsErr = new CLIError(
        `File system error: ${err.message}`,
        ExitCode.GENERAL,
        hint,
      );
      return handleError(fsErr);
    } else if (typeof ecode === 'string' && ecode.startsWith('E')) {
      // All other Node.js filesystem error codes (EMFILE, EEXIST, EROFS, etc.)
      const fsErr = new CLIError(
        `File system error: ${err.message}`,
        ExitCode.GENERAL,
        'Check the file path and permissions.',
      );
      return handleError(fsErr);
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
