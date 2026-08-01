import { describe, expect, it } from 'bun:test';
import type { VideoV2ImageRole, VideoV2Request } from '../../src/types/api';
import {
  buildVideoV2Request,
  validateVideoV2Request,
} from '../../src/video/v2';
import {
  VIDEO_V2_MAX_REQUEST_BODY_BYTES,
  VIDEO_V2_MEDIA_SIZE_LIMITS,
} from '../../src/utils/media';

const prompt = 'A cinematic test scene';

function referenceImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/reference-${index}.png`,
    role: 'reference_image' as const,
  }));
}

function referenceMedia(count: number, extension: string) {
  return Array.from(
    { length: count },
    (_, index) => `https://example.com/reference-${index}.${extension}`,
  );
}

function oversizedDataUri(kind: keyof typeof VIDEO_V2_MEDIA_SIZE_LIMITS, mime: string): string {
  const decodedBytes = VIDEO_V2_MEDIA_SIZE_LIMITS[kind] + 1;
  const base64Length = Math.ceil(decodedBytes / 3) * 4;
  return `data:${mime};base64,${'A'.repeat(base64Length)}`;
}

describe('Video Generation V2 request builder', () => {
  it('maps first-frame, last-frame-only, and first-plus-last-frame inputs', () => {
    const cases: Array<{
      images: Array<{ url: string; role: VideoV2ImageRole }>;
      expectedRoles: VideoV2ImageRole[];
    }> = [
      {
        images: [{ url: 'https://example.com/first.png', role: 'first_frame' }],
        expectedRoles: ['first_frame'],
      },
      {
        images: [{ url: 'https://example.com/last.png', role: 'last_frame' }],
        expectedRoles: ['last_frame'],
      },
      {
        images: [
          { url: 'https://example.com/first.png', role: 'first_frame' },
          { url: 'https://example.com/last.png', role: 'last_frame' },
        ],
        expectedRoles: ['first_frame', 'last_frame'],
      },
    ];

    for (const testCase of cases) {
      const request = buildVideoV2Request({ prompt, images: testCase.images });
      const roles = request.content
        .filter(item => item.type === 'image_url')
        .map(item => item.role);

      expect(roles).toEqual(testCase.expectedRoles);
      expect(request.ratio).toBe('adaptive');
    }
  });

  it('rejects multiple images unless every image has an explicit role', () => {
    expect(() => buildVideoV2Request({
      prompt,
      images: [
        { url: 'https://example.com/one.png' },
        { url: 'https://example.com/two.png', role: 'reference_image' },
      ],
    })).toThrow('Each image must specify a role');
  });

  it('rejects invalid media roles at runtime', () => {
    expect(() => buildVideoV2Request({
      prompt,
      images: [{
        url: 'https://example.com/image.png',
        role: 'thumbnail' as VideoV2ImageRole,
      }],
    })).toThrow('image role must be one of');

    const invalidVideoRole = buildVideoV2Request({ prompt });
    invalidVideoRole.content.push({
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
      role: 'reference_audio',
    } as never);
    expect(() => validateVideoV2Request(invalidVideoRole)).toThrow(
      'video role must be reference_video',
    );
  });

  it('rejects reference audio without a reference image or video', () => {
    expect(() => buildVideoV2Request({
      prompt,
      referenceAudios: ['https://example.com/audio.mp3'],
    })).toThrow('reference audio requires at least one reference image or reference video');
  });

  it('rejects frame inputs mixed with reference inputs', () => {
    expect(() => buildVideoV2Request({
      prompt,
      images: [{ url: 'https://example.com/first.png', role: 'first_frame' }],
      referenceVideos: ['https://example.com/reference.mp4'],
    })).toThrow('frame inputs and reference inputs cannot be used together');
  });

  it('validates resolution, duration, and ratio boundaries', () => {
    expect(() => buildVideoV2Request({ prompt, resolution: '1080P' }))
      .toThrow('only supports 2K resolution');

    for (const duration of [3, 16, 4.5]) {
      expect(() => buildVideoV2Request({ prompt, duration }))
        .toThrow('duration must be an integer from 4 to 15 seconds');
    }

    expect(() => buildVideoV2Request({ prompt, ratio: '2:1' }))
      .toThrow('ratio must be one of');
    expect(() => buildVideoV2Request({ prompt, ratio: 'adaptive' }))
      .toThrow('text-to-video requires a concrete ratio');
  });

  it('accepts and rejects reference input count boundaries', () => {
    expect(() => buildVideoV2Request({ prompt, images: referenceImages(9) })).not.toThrow();
    expect(() => buildVideoV2Request({ prompt, images: referenceImages(10) }))
      .toThrow('accepts up to 9 reference images');

    expect(() => buildVideoV2Request({
      prompt,
      referenceVideos: referenceMedia(3, 'mp4'),
    })).not.toThrow();
    expect(() => buildVideoV2Request({
      prompt,
      referenceVideos: referenceMedia(4, 'mp4'),
    })).toThrow('3 reference videos');

    expect(() => buildVideoV2Request({
      prompt,
      images: referenceImages(1),
      referenceAudios: referenceMedia(3, 'mp3'),
    })).not.toThrow();
    expect(() => buildVideoV2Request({
      prompt,
      images: referenceImages(1),
      referenceAudios: referenceMedia(4, 'mp3'),
    })).toThrow('3 reference audios');
  });

  it('rejects oversized Base64 image, video, and audio inputs', () => {
    expect(() => buildVideoV2Request({
      prompt,
      images: [{ url: oversizedDataUri('image', 'image/png'), role: 'reference_image' }],
    })).toThrow('image input is 30.0 MB; the maximum is 30 MB');

    expect(() => buildVideoV2Request({
      prompt,
      referenceVideos: [oversizedDataUri('video', 'video/mp4')],
    })).toThrow('video input is 50.0 MB; the maximum is 50 MB');

    expect(() => buildVideoV2Request({
      prompt,
      images: referenceImages(1),
      referenceAudios: [oversizedDataUri('audio', 'audio/mpeg')],
    })).toThrow('audio input is 15.0 MB; the maximum is 15 MB');
  });

  it('rejects a JSON request body larger than 64 MB', () => {
    const oversizedUrl = `https://example.com/${'a'.repeat(
      Math.floor(VIDEO_V2_MAX_REQUEST_BODY_BYTES / 9) + 1,
    )}`;

    expect(() => buildVideoV2Request({
      prompt,
      images: Array.from({ length: 9 }, () => ({
        url: oversizedUrl,
        role: 'reference_image' as const,
      })),
    })).toThrow('request body is 64.0 MB; the maximum is 64 MB');
  });
});

describe('Video Generation V2 raw request validation', () => {
  it('requires non-empty text content', () => {
    const request = {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '   ' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    } satisfies VideoV2Request;

    expect(() => validateVideoV2Request(request)).toThrow('requires a non-empty text content item');
  });
});
