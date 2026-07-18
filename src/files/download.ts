import { createWriteStream, renameSync, unlinkSync } from 'fs';
import { createProgressBar } from '../output/progress';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export interface DownloadOpts {
  quiet?: boolean;
  retries?: number;
  retryDelayMs?: number;
}

export async function downloadFile(
  url: string,
  destPath: string,
  opts?: DownloadOpts,
): Promise<{ size: number }> {
  // Fix: Alibaba Cloud OSS US East blocks HTTP from certain regions.
  // Force HTTPS to ensure reliable downloads.
  const downloadUrl = url.startsWith('http://') ? url.replace('http://', 'https://') : url;
  const maxRetries = opts?.retries ?? 3;
  const baseDelay = opts?.retryDelayMs ?? 1000;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        if (!opts?.quiet) {
          process.stderr.write(`\n  Retry ${attempt}/${maxRetries} in ${delay}ms...\n`);
        }
        await new Promise(r => setTimeout(r, delay));
      }

      const res = await fetch(downloadUrl);

      if (!res.ok) {
        throw new CLIError(`Download failed: HTTP ${res.status}`, ExitCode.GENERAL);
      }

      // fetch transparently decodes compressed responses, so Content-Length
      // only describes the readable body when no Content-Encoding is present.
      const contentLength = res.headers.get('content-encoding')
        ? 0
        : Number(res.headers.get('content-length') || 0);
      const reader = res.body?.getReader();
      if (!reader) throw new CLIError('No response body', ExitCode.GENERAL);

      const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${attempt}-${Math.random().toString(36).slice(2)}`;
      const writer = createWriteStream(tmpPath);
      const progress = contentLength > 0 && !opts?.quiet
        ? createProgressBar(contentLength, 'Downloading')
        : null;

      let received = 0;
      let readComplete = false;
      let completed = false;

      try {
        const writeError = new Promise<never>((_, reject) => {
          writer.on('error', reject);
        });

        while (true) {
          const { done, value } = await Promise.race([
            reader.read(),
            writeError,
          ]) as ReadableStreamReadResult<Uint8Array>;
          if (done) break;

          const ok = writer.write(value);
          if (!ok) await new Promise(r => writer.once('drain', r));

          received += value.byteLength;
          progress?.update(received);
        }

        if (contentLength > 0 && received !== contentLength) {
          throw new CLIError(
            `Download truncated: expected ${contentLength} bytes, received ${received}.`,
            ExitCode.NETWORK,
          );
        }
        readComplete = true;
      } finally {
        reader.releaseLock();
        progress?.finish();

        try {
          if (!writer.destroyed) {
            await new Promise<void>((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
              writer.end();
            });
            completed = readComplete;
          }
        } finally {
          if (!completed) {
            try { unlinkSync(tmpPath); } catch { /* best effort */ }
          }
        }
      }

      renameSync(tmpPath, destPath);
      return { size: received };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!opts?.quiet) {
        process.stderr.write(`\n  Download attempt ${attempt + 1} failed: ${lastError.message}\n`);
      }
    }
  }

  throw new CLIError(
    `Download failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    ExitCode.NETWORK,
    'Check your network connection and proxy settings.',
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
