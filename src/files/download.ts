import { createWriteStream, renameSync, unlinkSync } from 'fs';
import type { WriteStream } from 'fs';
import { createProgressBar } from '../output/progress';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const DEFAULT_OVERALL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 1000;

export interface DownloadOpts {
  quiet?: boolean;
  retries?: number;
  retryDelayMs?: number;
  overallTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

class RetryableDownloadError extends CLIError {
  readonly retryAfterMs?: number;

  constructor(message: string, exitCode: ExitCode = ExitCode.NETWORK, retryAfterMs?: number) {
    super(message, exitCode);
    this.retryAfterMs = retryAfterMs;
  }
}

class DownloadHttpError extends CLIError {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`Download failed: HTTP ${status}`, ExitCode.GENERAL);
    this.retryable = status === 408 || status === 429 || status >= 500;
    this.retryAfterMs = retryAfterMs;
  }
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CLIError(`${name} must be a positive number.`, ExitCode.USAGE);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new CLIError(`${name} must be a non-negative integer.`, ExitCode.USAGE);
  }
  return value;
}

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CLIError(`${name} must be a non-negative number.`, ExitCode.USAGE);
  }
  return value;
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CLIError(fallback, ExitCode.GENERAL);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const length = BigInt(value);
  return length <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(length) : Number.POSITIVE_INFINITY;
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortReason(signal, 'Download aborted.');
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal, 'Download aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function withIdleTimeout<T>(
  operation: Promise<T>,
  controller: AbortController,
  idleTimeoutMs: number,
  phase: string,
  retryable = true,
): Promise<T> {
  if (controller.signal.aborted) {
    throw abortReason(controller.signal, 'Download aborted.');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = retryable
        ? new RetryableDownloadError(
          `Download idle timeout while ${phase} after ${idleTimeoutMs}ms.`,
          ExitCode.TIMEOUT,
        )
        : new CLIError(
          `Download idle timeout while ${phase} after ${idleTimeoutMs}ms.`,
          ExitCode.TIMEOUT,
        );
      controller.abort(error);
      reject(error);
    }, idleTimeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(controller.signal, 'Download aborted.'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, timeout, aborted]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw abortReason(controller.signal, 'Download aborted.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

async function waitForDrain(
  writer: WriteStream,
  controller: AbortController,
  idleTimeoutMs: number,
): Promise<void> {
  const drain = new Promise<void>((resolve, reject) => {
    const onDrain = () => finish(resolve);
    const onError = (error: Error) => finish(() => reject(error));
    const onClose = () => finish(() => reject(new Error('File writer closed before draining.')));
    const finish = (done: () => void) => {
      writer.off('drain', onDrain);
      writer.off('error', onError);
      writer.off('close', onClose);
      done();
    };

    writer.once('drain', onDrain);
    writer.once('error', onError);
    writer.once('close', onClose);
  });

  try {
    await withIdleTimeout(drain, controller, idleTimeoutMs, 'waiting for disk writes', false);
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      `Could not write download: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.GENERAL,
    );
  }
}

async function finishWriter(
  writer: WriteStream,
  controller: AbortController,
  idleTimeoutMs: number,
): Promise<void> {
  const finished = new Promise<void>((resolve, reject) => {
    const onFinish = () => finish(resolve);
    const onError = (error: Error) => finish(() => reject(error));
    const onClose = () => {
      if (!writer.writableFinished) finish(() => reject(new Error('File writer closed early.')));
    };
    const finish = (done: () => void) => {
      writer.off('finish', onFinish);
      writer.off('error', onError);
      writer.off('close', onClose);
      done();
    };

    writer.once('finish', onFinish);
    writer.once('error', onError);
    writer.once('close', onClose);
    writer.end();
  });

  try {
    await withIdleTimeout(finished, controller, idleTimeoutMs, 'finishing disk writes', false);
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      `Could not write download: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.GENERAL,
    );
  }
}

async function destroyWriter(writer: WriteStream): Promise<void> {
  if (writer.closed) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      writer.off('close', onClose);
      resolve();
    }, CLEANUP_TIMEOUT_MS);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    writer.once('close', onClose);
    writer.destroy();
  });
}

async function settleCleanup(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    operation.catch(() => undefined),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

async function attemptDownload(
  downloadUrl: string,
  destPath: string,
  attempt: number,
  opts: Required<Pick<DownloadOpts, 'quiet' | 'idleTimeoutMs' | 'maxBytes'>>,
  overallSignal: AbortSignal,
): Promise<{ size: number }> {
  const controller = new AbortController();
  const abortAttempt = () => controller.abort(abortReason(overallSignal, 'Download aborted.'));
  if (overallSignal.aborted) abortAttempt();
  else overallSignal.addEventListener('abort', abortAttempt, { once: true });

  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WriteStream | undefined;
  let tmpPath: string | undefined;
  let progress: ReturnType<typeof createProgressBar> | null = null;
  let succeeded = false;

  try {
    try {
      response = await withIdleTimeout(
        fetch(downloadUrl, { signal: controller.signal }),
        controller,
        opts.idleTimeoutMs,
        'waiting for response headers',
      );
    } catch (error) {
      if (error instanceof CLIError) throw error;
      throw new RetryableDownloadError(
        `Download request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new DownloadHttpError(
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    const declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== undefined && declaredLength > opts.maxBytes) {
      throw new CLIError(
        `Download exceeds maximum size of ${opts.maxBytes} bytes (Content-Length: ${declaredLength}).`,
        ExitCode.GENERAL,
      );
    }

    reader = response.body?.getReader();
    if (!reader) throw new CLIError('Download response has no body.', ExitCode.GENERAL);

    const expectedLength = response.headers.get('content-encoding')
      ? undefined
      : declaredLength;
    tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${attempt}-${Math.random().toString(36).slice(2)}`;
    writer = createWriteStream(tmpPath);
    progress = expectedLength && !opts.quiet
      ? createProgressBar(expectedLength, 'Downloading')
      : null;

    let writerError: Error | undefined;
    const writerFailed = new Promise<never>((_, reject) => {
      writer!.once('error', error => {
        writerError = error;
        reject(error);
      });
    });
    void writerFailed.catch(() => undefined);

    let received = 0;
    while (true) {
      let result: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;
      try {
        result = await withIdleTimeout(
          Promise.race([reader.read(), writerFailed]),
          controller,
          opts.idleTimeoutMs,
          'waiting for response data',
        );
      } catch (error) {
        if (writerError) {
          throw new CLIError(`Could not write download: ${writerError.message}`, ExitCode.GENERAL);
        }
        if (error instanceof CLIError) throw error;
        throw new RetryableDownloadError(
          `Download stream failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (result.done) break;
      const nextSize = received + result.value.byteLength;
      if (nextSize > opts.maxBytes) {
        throw new CLIError(
          `Download exceeds maximum size of ${opts.maxBytes} bytes.`,
          ExitCode.GENERAL,
        );
      }

      let accepted: boolean;
      try {
        accepted = writer.write(result.value);
      } catch (error) {
        throw new CLIError(
          `Could not write download: ${error instanceof Error ? error.message : String(error)}`,
          ExitCode.GENERAL,
        );
      }
      if (!accepted) await waitForDrain(writer, controller, opts.idleTimeoutMs);

      received = nextSize;
      progress?.update(received);
    }

    if (expectedLength !== undefined && received !== expectedLength) {
      throw new RetryableDownloadError(
        `Download truncated: expected ${expectedLength} bytes, received ${received}.`,
      );
    }

    await finishWriter(writer, controller, opts.idleTimeoutMs);
    writer = undefined;
    reader.releaseLock();
    reader = undefined;
    renameSync(tmpPath, destPath);
    tmpPath = undefined;
    succeeded = true;
    return { size: received };
  } finally {
    overallSignal.removeEventListener('abort', abortAttempt);
    progress?.finish();

    if (!succeeded) {
      if (reader) {
        await settleCleanup(reader.cancel(controller.signal.reason));
        try { reader.releaseLock(); } catch { /* best effort */ }
      } else if (response?.body) {
        await settleCleanup(response.body.cancel(controller.signal.reason));
      }
      if (writer) await destroyWriter(writer);
      if (tmpPath) {
        try { unlinkSync(tmpPath); } catch { /* best effort */ }
      }
    }
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
  opts?: DownloadOpts,
): Promise<{ size: number }> {
  // Alibaba Cloud OSS US East blocks HTTP from certain regions.
  const downloadUrl = url.startsWith('http://') ? url.replace('http://', 'https://') : url;
  const maxRetries = nonNegativeInteger(opts?.retries ?? 3, 'retries');
  const baseDelay = nonNegativeNumber(opts?.retryDelayMs ?? 1000, 'retryDelayMs');
  const overallTimeoutMs = positiveNumber(
    opts?.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS,
    'overallTimeoutMs',
  );
  const idleTimeoutMs = positiveNumber(
    opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    'idleTimeoutMs',
  );
  const maxBytes = positiveNumber(opts?.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes');
  const quiet = opts?.quiet ?? false;

  const overallController = new AbortController();
  const abortFromCaller = () => overallController.abort(
    abortReason(opts!.signal!, 'Download aborted by caller.'),
  );
  if (opts?.signal?.aborted) abortFromCaller();
  else opts?.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const overallTimer = setTimeout(() => {
    overallController.abort(new CLIError(
      `Download timed out after ${overallTimeoutMs}ms.`,
      ExitCode.TIMEOUT,
    ));
  }, overallTimeoutMs);

  let lastError: Error | undefined;
  let retryAfterMs: number | undefined;

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const delay = Math.max(exponentialDelay, retryAfterMs ?? 0);
        if (!quiet) {
          process.stderr.write(`\n  Retry ${attempt}/${maxRetries} in ${delay}ms...\n`);
        }
        await waitForDelay(delay, overallController.signal);
      }

      try {
        return await attemptDownload(
          downloadUrl,
          destPath,
          attempt,
          { quiet, idleTimeoutMs, maxBytes },
          overallController.signal,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (overallController.signal.aborted) {
          throw abortReason(overallController.signal, 'Download aborted.');
        }

        const retryable = error instanceof RetryableDownloadError
          || (error instanceof DownloadHttpError && error.retryable);
        if (!retryable) throw error;

        retryAfterMs = error instanceof DownloadHttpError || error instanceof RetryableDownloadError
          ? error.retryAfterMs
          : undefined;
        if (!quiet) {
          process.stderr.write(`\n  Download attempt ${attempt + 1} failed: ${lastError.message}\n`);
        }
        if (attempt === maxRetries) break;
      }
    }
  } finally {
    clearTimeout(overallTimer);
    opts?.signal?.removeEventListener('abort', abortFromCaller);
  }

  const exitCode = lastError instanceof CLIError ? lastError.exitCode : ExitCode.NETWORK;
  throw new CLIError(
    `Download failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    exitCode,
    exitCode === ExitCode.NETWORK ? 'Check your network connection and proxy settings.' : undefined,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
