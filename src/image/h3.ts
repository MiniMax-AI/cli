import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { downloadFile } from '../files/download';
import type {
  ImageH3Area,
  ImageH3EditRequest,
  ImageH3GenerationRequest,
  ImageH3OutputFormat,
  ImageH3Request,
  ImageH3Response,
  ImageH3ResponseFormat,
} from '../types/api';
import { IMAGE_MIME_TYPES, localFileToDataUri } from '../utils/image';
import { dataUriDecodedSize } from '../utils/media';

export const IMAGE_H3_MODEL = 'MiniMax-H3-Image' as const;

/**
 * The server waits up to 600 s. The endpoints are not idempotent: a client-side
 * timeout still gets the request billed, so never time out before the server.
 */
export const IMAGE_H3_MIN_TIMEOUT_SEC = 600;

export const IMAGE_H3_MAX_PROMPT_CHARS = 32000;
export const IMAGE_H3_MAX_IMAGES_PER_REQUEST = 10;
export const IMAGE_H3_MAX_REFERENCE_IMAGES = 16;
export const IMAGE_H3_MIN_AREA = 655_360;
export const IMAGE_H3_MAX_AREA = 20_000_000;
export const IMAGE_H3_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const IMAGE_H3_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

/** Per-image area used for the b64_json budget when size is auto (e.g. 4K = 4096 x 4096). */
const AREA_LEVEL_PIXELS: Record<ImageH3Area, number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 4096 * 4096,
};
/** b64_json total output area (n x width x height) limits by output format. */
export const IMAGE_H3_B64_MAX_TOTAL_AREA_PNG = 20_000_000;
export const IMAGE_H3_B64_MAX_TOTAL_AREA = 80_000_000;

const AREAS = new Set<ImageH3Area>(['1K', '2K', '4K']);
const OUTPUT_FORMATS = new Set<ImageH3OutputFormat>(['png', 'jpeg', 'jpg', 'webp']);
const RESPONSE_FORMATS = new Set<ImageH3ResponseFormat>(['url', 'b64_json']);

export class ImageH3InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageH3InputError';
  }
}

export interface BuildImageH3RequestOptions {
  prompt: string;
  /** Reference images (URL, data URI or mm_file://). Non-empty switches to the edits endpoint. */
  images?: string[];
  n?: number;
  size?: string;
  aspectRatio?: string;
  area?: string;
  outputFormat?: string;
  outputCompression?: number;
  responseFormat?: string;
  disablePromptEnhanced?: boolean;
  aigcWatermark?: boolean;
}

export function isImageH3Model(model: string | undefined): model is typeof IMAGE_H3_MODEL {
  return model === IMAGE_H3_MODEL;
}

export function isImageH3EditRequest(request: ImageH3Request): request is ImageH3EditRequest {
  return Array.isArray((request as ImageH3EditRequest).images);
}

export function isImageH3Response(response: unknown): response is ImageH3Response {
  return typeof response === 'object' && response !== null
    && Array.isArray((response as ImageH3Response).data);
}

/** File extension for a response `output_format` (`jpeg` → `jpg`). */
export function imageH3Extension(format: string | undefined): string {
  if (format === 'png' || format === 'webp') return format;
  return 'jpg';
}

/** Normalise a CLI response-format value; `base64` is kept as an alias of `b64_json`. */
export function normalizeImageH3ResponseFormat(value: string | undefined): string | undefined {
  return value === 'base64' ? 'b64_json' : value;
}

/**
 * Resolve a reference image for the edits endpoint: URLs, data URIs and
 * mm_file:// IDs pass through; local files are checked and Base64-encoded.
 */
export function resolveImageH3Input(input: string): string {
  if (
    input.startsWith('http://') ||
    input.startsWith('https://') ||
    input.startsWith('data:') ||
    input.startsWith('mm_file://')
  ) {
    return input;
  }
  if (!existsSync(input)) {
    throw new ImageH3InputError(`Reference image not found: ${input}`);
  }
  const ext = extname(input).toLowerCase();
  if (!IMAGE_MIME_TYPES[ext]) {
    throw new ImageH3InputError(
      `Unsupported reference image format "${ext}". Supported: jpg, jpeg, png, webp, heic, heif.`,
    );
  }
  return localFileToDataUri(input, IMAGE_H3_MAX_FILE_BYTES);
}

export function buildImageH3Request(options: BuildImageH3RequestOptions): ImageH3Request {
  const base = {
    model: IMAGE_H3_MODEL,
    prompt: options.prompt,
    n: options.n,
    size: options.size,
    aspect_ratio: options.aspectRatio,
    area: options.area as ImageH3Area | undefined,
    output_format: options.outputFormat as ImageH3OutputFormat | undefined,
    output_compression: options.outputCompression,
    response_format: normalizeImageH3ResponseFormat(options.responseFormat) as ImageH3ResponseFormat | undefined,
    aigc_watermark: options.aigcWatermark || undefined,
  };

  const images = options.images ?? [];
  let request: ImageH3Request;
  if (images.length > 0) {
    if (options.disablePromptEnhanced) {
      throw new ImageH3InputError(
        'Prompt enhancement is always on for image edits; --no-prompt-enhance only applies to text-to-image.',
      );
    }
    request = { ...base, images: images.map(url => ({ image_url: url })) };
  } else {
    request = { ...base, disable_prompt_enhanced: options.disablePromptEnhanced || undefined };
  }

  // Drop undefined keys so --dry-run shows exactly what is sent.
  for (const key of Object.keys(request) as Array<keyof ImageH3Request>) {
    if (request[key] === undefined) delete request[key];
  }

  validateImageH3Request(request);
  return request;
}

function parseRatio(value: string): [number, number] | undefined {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2])];
}

function withinRatioRange(a: number, b: number): boolean {
  return Math.max(a, b) <= 3 * Math.min(a, b);
}

export function validateImageH3Request(request: ImageH3Request): void {
  if (!isImageH3Model(request.model)) {
    throw new ImageH3InputError(`Only ${IMAGE_H3_MODEL} is supported by /v1/images/*.`);
  }

  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (!prompt) {
    throw new ImageH3InputError('MiniMax-H3-Image requires a non-empty prompt.');
  }
  if ([...prompt].length > IMAGE_H3_MAX_PROMPT_CHARS) {
    throw new ImageH3InputError(`MiniMax-H3-Image prompt must not exceed ${IMAGE_H3_MAX_PROMPT_CHARS} characters.`);
  }

  if (request.n !== undefined
    && (!Number.isInteger(request.n) || request.n < 1 || request.n > IMAGE_H3_MAX_IMAGES_PER_REQUEST)) {
    throw new ImageH3InputError(`MiniMax-H3-Image n must be an integer from 1 to ${IMAGE_H3_MAX_IMAGES_PER_REQUEST}.`);
  }

  const size = request.size;
  const explicitSize = size !== undefined && size !== 'auto';
  if (explicitSize) {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) {
      throw new ImageH3InputError('MiniMax-H3-Image size must be "auto" or WIDTHxHEIGHT, e.g. 2720x1536.');
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    const area = width * height;
    if (width < 1 || height < 1 || area < IMAGE_H3_MIN_AREA || area > IMAGE_H3_MAX_AREA) {
      throw new ImageH3InputError(
        `MiniMax-H3-Image size area (width x height) must be between 655,360 and 20,000,000 pixels, got ${area.toLocaleString('en-US')}.`,
      );
    }
    if (!withinRatioRange(width, height)) {
      throw new ImageH3InputError('MiniMax-H3-Image size aspect ratio must be between 1:3 and 3:1.');
    }
    if (request.aspect_ratio !== undefined || request.area !== undefined) {
      throw new ImageH3InputError('MiniMax-H3-Image size WIDTHxHEIGHT cannot be combined with aspect ratio or area.');
    }
  }

  const aspectRatio = request.aspect_ratio;
  if (aspectRatio !== undefined && aspectRatio !== 'auto') {
    const ratio = parseRatio(aspectRatio);
    if (!ratio || ratio.some(v => v < 1 || v > 300)) {
      throw new ImageH3InputError('MiniMax-H3-Image aspect ratio must be "auto" or X:Y with integers from 1 to 300.');
    }
    if (!withinRatioRange(ratio[0], ratio[1])) {
      throw new ImageH3InputError('MiniMax-H3-Image aspect ratio must be between 1:3 and 3:1.');
    }
  }

  if (request.area !== undefined && !AREAS.has(request.area)) {
    throw new ImageH3InputError('MiniMax-H3-Image area must be one of: 1K, 2K, 4K.');
  }
  if (request.output_format !== undefined && !OUTPUT_FORMATS.has(request.output_format)) {
    throw new ImageH3InputError('MiniMax-H3-Image output format must be one of: jpg, jpeg, png, webp.');
  }
  if (request.output_compression !== undefined
    && (!Number.isInteger(request.output_compression) || request.output_compression < 0 || request.output_compression > 100)) {
    throw new ImageH3InputError('MiniMax-H3-Image output compression must be an integer from 0 to 100.');
  }
  if (request.response_format !== undefined && !RESPONSE_FORMATS.has(request.response_format)) {
    throw new ImageH3InputError('MiniMax-H3-Image response format must be url or b64_json (alias: base64).');
  }

  if (request.response_format === 'b64_json') {
    const perImage = explicitSize
      ? Number(size.split('x')[0]) * Number(size.split('x')[1])
      : AREA_LEVEL_PIXELS[request.area ?? '4K'];
    const total = (request.n ?? 1) * perImage;
    const isPng = request.output_format === 'png';
    const limit = isPng ? IMAGE_H3_B64_MAX_TOTAL_AREA_PNG : IMAGE_H3_B64_MAX_TOTAL_AREA;
    if (total > limit) {
      throw new ImageH3InputError(
        `MiniMax-H3-Image b64_json total output area (n x width x height) is ${total.toLocaleString('en-US')} px; `
        + `the limit for ${isPng ? 'png' : 'jpeg/webp'} is ${limit.toLocaleString('en-US')} px. `
        + 'Lower n or the size/area, or use the url response format.',
      );
    }
  }

  if (isImageH3EditRequest(request)) {
    if ((request as ImageH3GenerationRequest).disable_prompt_enhanced !== undefined) {
      throw new ImageH3InputError('disable_prompt_enhanced is not supported for image edits (enhancement is always on).');
    }
    const count = request.images.length;
    if (count < 1 || count > IMAGE_H3_MAX_REFERENCE_IMAGES) {
      throw new ImageH3InputError(`MiniMax-H3-Image accepts 1 to ${IMAGE_H3_MAX_REFERENCE_IMAGES} reference images.`);
    }
    for (const image of request.images) {
      if (typeof image?.image_url !== 'string' || !image.image_url) {
        throw new ImageH3InputError('Each reference image needs a non-empty image_url.');
      }
      const decoded = dataUriDecodedSize(image.image_url);
      if (decoded !== undefined && decoded > IMAGE_H3_MAX_FILE_BYTES) {
        throw new ImageH3InputError(
          `MiniMax-H3-Image reference image is ${(decoded / 1024 / 1024).toFixed(1)} MB; the maximum is 64 MB.`,
        );
      }
    }
  } else if (request.disable_prompt_enhanced) {
    const hasConcreteRatio = aspectRatio !== undefined && aspectRatio !== 'auto';
    if (!explicitSize && !hasConcreteRatio) {
      throw new ImageH3InputError(
        'With prompt enhancement disabled, MiniMax-H3-Image needs an explicit size (WIDTHxHEIGHT) or aspect ratio (X:Y).',
      );
    }
  }

  const bodyBytes = Buffer.byteLength(JSON.stringify(request));
  if (bodyBytes > IMAGE_H3_MAX_REQUEST_BODY_BYTES) {
    throw new ImageH3InputError(
      `MiniMax-H3-Image request body is ${(bodyBytes / 1024 / 1024).toFixed(1)} MB; the maximum is 64 MB. Use public URLs or mm_file:// file IDs instead of local files.`,
    );
  }
}

export interface ImageH3SaveOptions {
  /** Save to an exact file path (only valid when at most one image succeeded). */
  out?: string;
  /** Directory for numbered files (default: "."). */
  outDir?: string;
  /** Filename prefix (default: "image"). */
  prefix?: string;
  /** Suppress download progress. */
  quiet?: boolean;
  /** Print a warning to stderr before overwriting an existing file. */
  warnOverwrite?: boolean;
}

export interface ImageH3Failure {
  /** 0-based position in the response `data` array. */
  index: number;
  code?: string;
  message?: string;
}

export interface ImageH3SaveResult {
  /** Absolute paths of saved images. */
  saved: string[];
  failures: ImageH3Failure[];
}

/**
 * Save the successful items of a MiniMax-H3-Image response. Files are named by
 * their position in `data` (`image_001.jpg`, `image_002.jpg`, ...), so a failed
 * item leaves a gap instead of shifting later images.
 */
export async function saveImageH3Images(
  response: ImageH3Response,
  options: ImageH3SaveOptions = {},
): Promise<ImageH3SaveResult> {
  const ext = imageH3Extension(response.output_format);
  const failures: ImageH3Failure[] = [];
  const succeeded: Array<{ index: number; url?: string; b64?: string }> = [];

  response.data.forEach((item, index) => {
    if (item.url || item.b64_json) {
      succeeded.push({ index, url: item.url, b64: item.b64_json });
    } else {
      failures.push({ index, code: item.error?.code, message: item.error?.message });
    }
  });

  if (options.out && succeeded.length > 1) {
    throw new ImageH3InputError('Cannot use `out` with multiple images. Use `outDir` instead.');
  }

  const saved: string[] = [];
  const quiet = options.quiet ?? true;
  const outDir = resolve(options.outDir || '.');
  const prefix = options.prefix || 'image';

  for (const image of succeeded) {
    const destPath = options.out
      ? resolve(options.out)
      : join(outDir, `${prefix}_${String(image.index + 1).padStart(3, '0')}.${ext}`);
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (options.warnOverwrite && existsSync(destPath)) {
      process.stderr.write(`Warning: overwriting existing file: ${destPath}\n`);
    }
    if (image.b64) {
      writeFileSync(destPath, image.b64, 'base64');
    } else {
      await downloadFile(image.url!, destPath, { quiet });
    }
    saved.push(destPath);
  }

  return { saved, failures };
}
