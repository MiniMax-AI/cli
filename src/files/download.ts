import { createWriteStream, unlinkSync } from 'fs';
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

      const contentLength = Number(res.headers.get('content-length') || 0);
      const reader = res.body?.getReader();
      if (!reader) throw new CLIError('No response body', ExitCode.GENERAL);

      const writer = createWriteStream(destPath);
      const progress = contentLength > 0 && !opts?.quiet
        ? createProgressBar(contentLength, 'Downloading')
        : null;

      let received = 0;
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
        completed = true;
      } finally {
        reader.releaseLock();
        progress?.finish();

        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          writer.end();
        });

        if (!completed) {
          try { unlinkSync(destPath); } catch { /* best effort */ }
        }
      }

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
