import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const MEDIA_MIME_TYPES = {
  video: {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
  },
  audio: {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
  },
} as const;

export const VIDEO_V2_MEDIA_SIZE_LIMITS = {
  image: 30 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
} as const;

export const VIDEO_V2_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

export function dataUriDecodedSize(input: string): number | undefined {
  const match = /^data:[^;,]+;base64,([\s\S]*)$/.exec(input);
  if (!match) return undefined;

  const base64 = match[1]!.replace(/\s/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

export function resolveMediaInput(input: string, kind: keyof typeof MEDIA_MIME_TYPES): string {
  if (
    input.startsWith('http://') ||
    input.startsWith('https://') ||
    input.startsWith('mm_file://')
  ) {
    return input;
  }

  if (input.startsWith('data:')) {
    return kind === 'audio'
      ? input.replace(/^data:audio\/mpeg;base64,/, 'data:audio/mp3;base64,')
      : input;
  }

  if (!existsSync(input)) {
    throw new CLIError(`File not found: ${input}`, ExitCode.USAGE);
  }

  const ext = extname(input).toLowerCase();
  const mimeTypes = MEDIA_MIME_TYPES[kind] as Record<string, string>;
  const mime = mimeTypes[ext];
  if (!mime) {
    const supported = Object.keys(mimeTypes).map(value => value.slice(1)).join(', ');
    throw new CLIError(`Unsupported ${kind} format "${ext}". Supported local files: ${supported}`, ExitCode.USAGE);
  }

  const maxBytes = VIDEO_V2_MEDIA_SIZE_LIMITS[kind];
  const size = statSync(input).size;
  if (size > maxBytes) {
    throw new CLIError(
      `${kind[0]!.toUpperCase()}${kind.slice(1)} file is ${(size / 1024 / 1024).toFixed(1)} MB; MiniMax-H3 allows at most ${maxBytes / 1024 / 1024} MB.`,
      ExitCode.USAGE,
      'Use a public URL or mm_file:// file ID for large media.',
    );
  }

  const data = readFileSync(input);
  return `data:${mime};base64,${data.toString('base64')}`;
}
