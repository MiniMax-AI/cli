import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { ContentBlock } from '../types/api';

type ImageBlock = Extract<ContentBlock, { type: 'image' }>;

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
    const res = await fetch(image);
    if (!res.ok) throw new CLIError(`Failed to download image: HTTP ${res.status}`, ExitCode.GENERAL);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mime = contentType.split(';')[0]!.trim();
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new CLIError(
        `Image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
        ExitCode.USAGE,
      );
    }
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  }

  if (!existsSync(image)) throw new CLIError(`File not found: ${image}`, ExitCode.USAGE);
  const ext = extname(image).toLowerCase();
  if (!IMAGE_MIME_TYPES[ext]) throw new CLIError(`Unsupported image format "${ext}". Supported: jpg, jpeg, png, webp`, ExitCode.USAGE);
  return localFileToDataUri(image);
}

/**
 * Convert a path / URL / data URI into an Anthropic-shaped image content block.
 * The Messages API rejects the OpenAI `image_url` shape, so callers targeting
 * `/anthropic/v1/messages` must use this instead of a raw data URI.
 */
export async function toImageBlock(image: string): Promise<ImageBlock> {
  const uri = await toDataUri(image);
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!match) {
    throw new CLIError(
      `Unsupported image source "${image}": expected a base64 data URI, file path, or http(s) URL.`,
      ExitCode.USAGE,
    );
  }
  return { type: 'image', source: { type: 'base64', media_type: match[1]!, data: match[2]! } };
}
