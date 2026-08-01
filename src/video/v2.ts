import type {
  VideoRequest,
  VideoV2ContentItem,
  VideoV2Duration,
  VideoV2ImageRole,
  VideoV2Ratio,
  VideoV2Request,
} from '../types/api';
import {
  dataUriDecodedSize,
  VIDEO_V2_MAX_REQUEST_BODY_BYTES,
  VIDEO_V2_MEDIA_SIZE_LIMITS,
} from '../utils/media';

export const VIDEO_V2_MODEL = 'MiniMax-H3' as const;

const VIDEO_V2_RATIOS = new Set<VideoV2Ratio>([
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]);

const VIDEO_V2_IMAGE_ROLES = new Set<VideoV2ImageRole>([
  'first_frame',
  'last_frame',
  'reference_image',
]);

export class VideoV2InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoV2InputError';
  }
}

export interface VideoV2ImageInput {
  url: string;
  role?: VideoV2ImageRole;
}

export interface BuildVideoV2RequestOptions {
  prompt: string;
  images?: VideoV2ImageInput[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  resolution?: string;
  duration?: number;
  ratio?: string;
  callbackUrl?: string;
}

export function isVideoV2Model(model: string | undefined): model is typeof VIDEO_V2_MODEL {
  return model === VIDEO_V2_MODEL;
}

export function isVideoV2Request(request: VideoRequest | VideoV2Request): request is VideoV2Request {
  return isVideoV2Model(request.model);
}

export function buildVideoV2Request(options: BuildVideoV2RequestOptions): VideoV2Request {
  const images = options.images ?? [];
  if (images.length > 1 && images.some(image => !image.role)) {
    throw new VideoV2InputError('Each image must specify a role when multiple images are provided.');
  }

  const content: VideoV2ContentItem[] = [
    { type: 'text', text: options.prompt },
    ...images.map(image => ({
      type: 'image_url' as const,
      image_url: { url: image.url },
      role: image.role ?? 'first_frame',
    })),
    ...(options.referenceVideos ?? []).map(url => ({
      type: 'video_url' as const,
      video_url: { url },
      role: 'reference_video' as const,
    })),
    ...(options.referenceAudios ?? []).map(url => ({
      type: 'audio_url' as const,
      audio_url: { url },
      role: 'reference_audio' as const,
    })),
  ];

  const hasFrameInput = content.some(item =>
    item.type === 'image_url' && (item.role === 'first_frame' || item.role === 'last_frame'),
  );
  const hasReferenceInput = content.some(item =>
    item.type !== 'text' && item.role?.startsWith('reference_'),
  );

  const request: VideoV2Request = {
    model: VIDEO_V2_MODEL,
    content,
    resolution: (options.resolution ?? '2K') as '2K',
    duration: (options.duration ?? 5) as VideoV2Duration,
    ratio: (hasFrameInput
      ? 'adaptive'
      : options.ratio ?? (hasReferenceInput ? 'adaptive' : '16:9')) as VideoV2Ratio,
  };

  if (options.callbackUrl) request.callback_url = options.callbackUrl;

  validateVideoV2Request(request);
  return request;
}

export function validateVideoV2Request(request: VideoV2Request): void {
  if (!isVideoV2Model(request.model)) {
    throw new VideoV2InputError(`Video Generation V2 only supports ${VIDEO_V2_MODEL}.`);
  }

  const textItems = request.content.filter(item => item.type === 'text');
  if (!textItems.some(item => item.text.trim().length > 0)) {
    throw new VideoV2InputError('MiniMax-H3 requires a non-empty text content item.');
  }
  if (textItems.some(item => item.text.length > 7000)) {
    throw new VideoV2InputError('MiniMax-H3 text content must not exceed 7000 characters.');
  }

  if (request.resolution !== '2K') {
    throw new VideoV2InputError('MiniMax-H3 currently only supports 2K resolution.');
  }
  if (!Number.isInteger(request.duration) || request.duration < 4 || request.duration > 15) {
    throw new VideoV2InputError('MiniMax-H3 duration must be an integer from 4 to 15 seconds.');
  }
  if (request.ratio && !VIDEO_V2_RATIOS.has(request.ratio)) {
    throw new VideoV2InputError(
      'MiniMax-H3 ratio must be one of: adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.',
    );
  }

  const images = request.content.filter(item => item.type === 'image_url');
  const videos = request.content.filter(item => item.type === 'video_url');
  const audios = request.content.filter(item => item.type === 'audio_url');

  if (images.some(item => item.role && !VIDEO_V2_IMAGE_ROLES.has(item.role))) {
    throw new VideoV2InputError(
      'MiniMax-H3 image role must be one of: first_frame, last_frame, reference_image.',
    );
  }
  if (videos.some(item => item.role !== 'reference_video')) {
    throw new VideoV2InputError('MiniMax-H3 video role must be reference_video.');
  }
  if (audios.some(item => item.role !== 'reference_audio')) {
    throw new VideoV2InputError('MiniMax-H3 audio role must be reference_audio.');
  }

  for (const image of images) {
    validateDataUriSize(image.image_url.url, 'image');
  }
  for (const video of videos) {
    validateDataUriSize(video.video_url.url, 'video');
  }
  for (const audio of audios) {
    validateDataUriSize(audio.audio_url.url, 'audio');
  }

  const requestBodyBytes = Buffer.byteLength(JSON.stringify(request));
  if (requestBodyBytes > VIDEO_V2_MAX_REQUEST_BODY_BYTES) {
    throw new VideoV2InputError(
      `MiniMax-H3 request body is ${(requestBodyBytes / 1024 / 1024).toFixed(1)} MB; the maximum is 64 MB. Use public URLs or mm_file:// file IDs instead of Base64.`,
    );
  }
  const firstFrames = images.filter(item => !item.role || item.role === 'first_frame');
  const lastFrames = images.filter(item => item.role === 'last_frame');
  const referenceImages = images.filter(item => item.role === 'reference_image');
  const hasFrameInput = firstFrames.length > 0 || lastFrames.length > 0;
  const hasReferenceInput = referenceImages.length > 0 || videos.length > 0 || audios.length > 0;

  if (firstFrames.length > 1 || lastFrames.length > 1) {
    throw new VideoV2InputError('MiniMax-H3 accepts at most one first frame and one last frame.');
  }
  if (referenceImages.length > 9 || videos.length > 3 || audios.length > 3) {
    throw new VideoV2InputError('MiniMax-H3 accepts up to 9 reference images, 3 reference videos, and 3 reference audios.');
  }
  if (hasFrameInput && hasReferenceInput) {
    throw new VideoV2InputError('MiniMax-H3 frame inputs and reference inputs cannot be used together.');
  }
  if (audios.length > 0 && referenceImages.length === 0 && videos.length === 0) {
    throw new VideoV2InputError('MiniMax-H3 reference audio requires at least one reference image or reference video.');
  }

  const isTextOnly = request.content.every(item => item.type === 'text');
  if (isTextOnly && (!request.ratio || request.ratio === 'adaptive')) {
    throw new VideoV2InputError('MiniMax-H3 text-to-video requires a concrete ratio; adaptive is not supported.');
  }
}

function validateDataUriSize(
  url: string,
  kind: keyof typeof VIDEO_V2_MEDIA_SIZE_LIMITS,
): void {
  const size = dataUriDecodedSize(url);
  const maxBytes = VIDEO_V2_MEDIA_SIZE_LIMITS[kind];
  if (size !== undefined && size > maxBytes) {
    throw new VideoV2InputError(
      `MiniMax-H3 ${kind} input is ${(size / 1024 / 1024).toFixed(1)} MB; the maximum is ${maxBytes / 1024 / 1024} MB.`,
    );
  }
}
