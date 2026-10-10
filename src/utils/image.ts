import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { safeFetch } from './network';

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

export function localFileToDataUri(filePath: string, maxBytes?: number): string {
  if (maxBytes !== undefined) {
    const size = statSync(filePath).size;
    if (size > maxBytes) {
      throw new CLIError(
        `Image file is ${(size / 1024 / 1024).toFixed(1)} MB; MiniMax-H3 allows at most ${maxBytes / 1024 / 1024} MB.`,
        ExitCode.USAGE,
        'Use a public URL or mm_file:// file ID for large images.',
      );
    }
  }
  const ext = extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_TYPES[ext] || 'image/jpeg';
  const data = readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

export function resolveImageInput(input: string, maxBytes?: number): string {
  return input.startsWith('http') || input.startsWith('data:') || input.startsWith('mm_file://')
    ? input
    : localFileToDataUri(input, maxBytes);
}

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

export async function toDataUri(image: string): Promise<string> {
  if (image.startsWith('data:')) return image;

  if (image.startsWith('http://') || image.startsWith('https://')) {
    const res = await safeFetch(image, {}, { timeoutMs: 30000 });
    if (!res.ok) throw new CLIError(`Failed to download image: HTTP ${res.status}`, ExitCode.GENERAL);

    const declaredLength = res.headers.get('content-length');
    if (declaredLength && Number(declaredLength) > MAX_IMAGE_SIZE_BYTES) {
      throw new CLIError(
        `Image too large (${(Number(declaredLength) / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
        ExitCode.USAGE,
      );
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mime = contentType.split(';')[0]!.trim();

    const reader = res.body?.getReader();
    if (!reader) throw new CLIError('Failed to read image response body.', ExitCode.GENERAL);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
          await reader.cancel();
          throw new CLIError(
            `Image too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
            ExitCode.USAGE,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const buf = Buffer.concat(chunks);
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  if (!existsSync(image)) throw new CLIError(`File not found: ${image}`, ExitCode.USAGE);
  const ext = extname(image).toLowerCase();
  if (!IMAGE_MIME_TYPES[ext]) throw new CLIError(`Unsupported image format "${ext}". Supported: jpg, jpeg, png, webp`, ExitCode.USAGE);
  return localFileToDataUri(image);
}
