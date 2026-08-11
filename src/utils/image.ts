import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { ContentBlock } from '../types/api';
import { dataUriDecodedSize } from './media';

type ImageBlock = Extract<ContentBlock, { type: 'image' }>;

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/** Per-image and format constraints for a specific caller (e.g. chat's Anthropic-API contract). */
export interface ImageValidationOptions {
  maxBytes: number;
  allowedMediaTypes: readonly string[];
}

export function localFileToDataUri(filePath: string, maxBytes?: number, mimeOverride?: string): string {
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
  const mime = mimeOverride || IMAGE_MIME_TYPES[ext] || 'image/jpeg';
  const data = readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

export function resolveImageInput(input: string, maxBytes?: number): string {
  return input.startsWith('http') || input.startsWith('data:') || input.startsWith('mm_file://')
    ? input
    : localFileToDataUri(input, maxBytes);
}

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

export async function toDataUri(image: string, opts?: ImageValidationOptions): Promise<string> {
  if (image.startsWith('data:')) {
    if (opts) {
      const mime = /^data:([^;,]+)[;,]/.exec(image)?.[1];
      if (!mime || !opts.allowedMediaTypes.includes(mime)) {
        throw new CLIError(
          `Unsupported image type "${mime ?? 'unknown'}". Supported: ${opts.allowedMediaTypes.join(', ')}`,
          ExitCode.USAGE,
        );
      }
      const size = dataUriDecodedSize(image);
      if (size !== undefined && size > opts.maxBytes) {
        throw new CLIError(
          `Image too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is ${(opts.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
          ExitCode.USAGE,
        );
      }
    }
    return image;
  }

  if (image.startsWith('http://') || image.startsWith('https://')) {
    const res = await fetch(image);
    if (!res.ok) throw new CLIError(`Failed to download image: HTTP ${res.status}`, ExitCode.GENERAL);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mime = contentType.split(';')[0]!.trim();
    const maxBytes = opts?.maxBytes ?? MAX_IMAGE_SIZE_BYTES;

    if (opts) {
      if (!opts.allowedMediaTypes.includes(mime)) {
        throw new CLIError(
          `Unsupported image type "${mime}". Supported: ${opts.allowedMediaTypes.join(', ')}`,
          ExitCode.USAGE,
        );
      }
      // content-length can lie or be absent, but checking it first avoids
      // buffering an oversized body just to reject it a moment later.
      const contentLength = Number(res.headers.get('content-length'));
      if (contentLength > maxBytes) {
        throw new CLIError(
          `Image too large (${(contentLength / 1024 / 1024).toFixed(1)} MB). Maximum is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
          ExitCode.USAGE,
        );
      }
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new CLIError(
        `Image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
        ExitCode.USAGE,
      );
    }
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  }

  if (!existsSync(image)) throw new CLIError(`File not found: ${image}`, ExitCode.USAGE);
  const ext = extname(image).toLowerCase();
  const mime = opts
    ? (IMAGE_MIME_TYPES[ext] ?? (ext === '.gif' ? 'image/gif' : undefined))
    : IMAGE_MIME_TYPES[ext];
  if (!mime || (opts && !opts.allowedMediaTypes.includes(mime))) {
    throw new CLIError(
      `Unsupported image format "${ext}". Supported: ${opts ? opts.allowedMediaTypes.join(', ') : 'jpg, jpeg, png, webp'}`,
      ExitCode.USAGE,
    );
  }
  if (opts) {
    const size = statSync(image).size;
    if (size > opts.maxBytes) {
      throw new CLIError(
        `Image too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is ${(opts.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
        ExitCode.USAGE,
      );
    }
    return localFileToDataUri(image, undefined, mime);
  }
  return localFileToDataUri(image);
}

/**
 * Convert a path / URL / data URI into an Anthropic-shaped image content block.
 * The Messages API rejects the OpenAI `image_url` shape, so callers targeting
 * `/anthropic/v1/messages` must use this instead of a raw data URI.
 */
export async function toImageBlock(image: string, opts?: ImageValidationOptions): Promise<ImageBlock> {
  const uri = await toDataUri(image, opts);
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!match) {
    throw new CLIError(
      `Unsupported image source "${image}": expected a base64 data URI, file path, or http(s) URL.`,
      ExitCode.USAGE,
    );
  }
  return { type: 'image', source: { type: 'base64', media_type: match[1]!, data: match[2]! } };
}
