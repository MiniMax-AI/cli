import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import {
  fileRetrieveEndpoint,
  videoGenerateEndpoint,
  videoGenerateV2Endpoint,
  videoTaskEndpoint,
  videoTaskV2Endpoint,
} from '../../client/endpoints';
import { poll } from '../../polling/poll';
import { downloadFile, formatBytes } from '../../files/download';
import { formatOutput, detectOutputFormat, dryRun } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type {
  FileRetrieveResponse,
  VideoRequest,
  VideoResponse,
  VideoTaskResponse,
  VideoV2Request,
  VideoV2Response,
  VideoV2TaskResponse,
} from '../../types/api';
import { resolveImageInput } from '../../utils/image';
import { resolveMediaInput, VIDEO_V2_MEDIA_SIZE_LIMITS } from '../../utils/media';
import { promptOrFail } from '../../utils/prompt';
import {
  buildVideoV2Request,
  isVideoV2Model,
  isVideoV2Request,
  VIDEO_V2_MODEL,
  VideoV2InputError,
} from '../../video/v2';

export default defineCommand({
  name: 'video generate',
  description: 'Generate a video\n  V2:   MiniMax-H3 (text/image/video/audio content, 2K)\n  T2V:  Hailuo-2.3\n  I2V:  Hailuo-2.3 (default) / Hailuo-2.3-Fast (fast mode, requires --image)\n  SEF:  Hailuo-02 (requires --image and --last-frame)\n  S2V:  S2V-01 (requires --subject-image)',
  apiDocs: '/docs/api-reference/video-generation-v2-create',
  usage: 'mmx video generate --prompt <text> [flags]',
  options: [
    { flag: '--model <model>', description: 'Model ID. V2: MiniMax-H3. Legacy: MiniMax-Hailuo-2.3 or MiniMax-Hailuo-2.3-Fast. Auto-switched to Hailuo-02 with --last-frame, or S2V-01 with --subject-image.' },
    { flag: '--prompt <text>', description: 'Video description', required: true },
    { flag: '--image <path-or-url>', description: 'Input image for image-to-video (local path or URL).' },
    { flag: '--first-frame <path-or-url>', description: 'Backward-compatible alias for --image.', hidden: true },
    { flag: '--last-frame <path-or-url>', description: 'Optional ending image. Legacy SEF also requires --image; MiniMax-H3 supports a last frame alone.' },
    { flag: '--subject-image <path-or-url>', description: 'Subject reference image for character consistency (local path or URL). Switches to S2V-01 model.' },
    { flag: '--reference-image <path-or-url>', description: 'H3 reference image (repeatable).', type: 'array' },
    { flag: '--reference-video <path-or-url>', description: 'H3 reference video (repeatable; local MP4, URL, data URI, or mm_file:// ID).', type: 'array' },
    { flag: '--reference-audio <path-or-url>', description: 'H3 reference audio (repeatable; requires a reference image or video).', type: 'array' },
    { flag: '--duration <seconds>', description: 'Output duration. H3 supports integer values from 4 to 15 (default: 5).', type: 'number' },
    { flag: '--ratio <ratio>', description: 'H3 aspect ratio: adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, or 9:16.' },
    { flag: '--callback-url <url>', description: 'Webhook URL for completion notification' },
    { flag: '--download <path>', description: 'Save video to file on completion' },
    { flag: '--no-wait', description: 'Return task ID immediately without waiting' },
    { flag: '--async', description: 'Return task ID immediately (agent/CI mode, same as --no-wait but explicit)' },
    { flag: '--poll-interval <seconds>', description: 'Polling interval when waiting (default: 5)', type: 'number' },
  ],
  examples: [
    'mmx video generate --prompt "A man reads a book. Static shot."',
    'mmx video generate --prompt "Ocean waves at sunset." --download sunset.mp4',
    'mmx video generate --prompt "A robot painting." --async --quiet',
    'mmx video generate --prompt "A robot painting." --no-wait --quiet',
    '# H3 text-to-video (Video Generation V2)',
    'mmx video generate --model MiniMax-H3 --prompt "Ocean waves at sunset"',
    '# H3 image-to-video',
    'mmx video generate --model MiniMax-H3 --prompt "The subject walks forward" --image start.jpg',
    '# H3 reference-to-video',
    'mmx video generate --model MiniMax-H3 --prompt "Keep the same character" --reference-image character.png --reference-video motion.mp4',
    '# SEF: first + last frame interpolation (uses Hailuo-02 model)',
    'mmx video generate --prompt "Walk forward" --image start.jpg --last-frame end.jpg',
    '# Subject reference: character consistency (uses S2V-01 model)',
    'mmx video generate --prompt "A detective walking" --subject-image character.jpg',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = flags.prompt as string | undefined;

    prompt = await promptOrFail({
      value: prompt,
      message: 'Enter your video prompt:',
      cancelMessage: 'Video generation cancelled.',
      flagName: 'prompt',
      usageHint: 'mmx video generate --prompt <text>',
      nonInteractive: config.nonInteractive,
    });

    const explicitModel = flags.model as string | undefined;
    const configuredModel = config.defaultVideoModel || 'MiniMax-Hailuo-2.3';
    const image = flags.image as string | undefined;
    const legacyFirstFrame = flags.firstFrame as string | undefined;
    if (image && legacyFirstFrame) {
      throw new CLIError(
        '--image and --first-frame are aliases; provide only one.',
        ExitCode.USAGE,
      );
    }
    const inputImage = image ?? legacyFirstFrame;
    const hasV2OnlyInput = Boolean(
      flags.referenceImage ||
      flags.referenceVideo ||
      flags.referenceAudio ||
      flags.duration !== undefined ||
      flags.ratio,
    );

    // Determine model: explicit --model > configured H3 default > legacy auto-switch > default
    let model: string;
    if (explicitModel) {
      model = explicitModel;
    } else if (isVideoV2Model(configuredModel)) {
      model = VIDEO_V2_MODEL;
    } else if (flags.lastFrame) {
      model = 'MiniMax-Hailuo-02';
    } else if (flags.subjectImage) {
      model = 'S2V-01';
    } else {
      model = configuredModel;
    }

    if (flags.lastFrame && flags.subjectImage) {
      throw new CLIError(
        '--last-frame and --subject-image cannot be used together (SEF and S2V are different modes).',
        ExitCode.USAGE,
        'mmx video generate --prompt <text> --image <path> --last-frame <path>',
      );
    }

    // MiniMax-Hailuo-2.3-Fast only supports I2V, not T2V
    if (explicitModel === 'MiniMax-Hailuo-2.3-Fast' && !inputImage) {
      throw new CLIError(
        'MiniMax-Hailuo-2.3-Fast only supports I2V (image-to-video). Use --image to provide an input image.',
        ExitCode.USAGE,
        'mmx video generate --prompt <text> --model MiniMax-Hailuo-2.3-Fast --image <path>',
      );
    }

    let body: VideoRequest | VideoV2Request;

    if (isVideoV2Model(model)) {
      if (flags.subjectImage) {
        throw new CLIError(
          '--subject-image is only supported by the legacy S2V-01 model. Use --reference-image for MiniMax-H3.',
          ExitCode.USAGE,
          'mmx video generate --model MiniMax-H3 --prompt <text> --reference-image <path>',
        );
      }

      const images = [
        ...(inputImage
          ? [{
              url: resolveImageInput(inputImage, VIDEO_V2_MEDIA_SIZE_LIMITS.image),
              role: 'first_frame' as const,
            }]
          : []),
        ...(flags.lastFrame
          ? [{
              url: resolveImageInput(flags.lastFrame as string, VIDEO_V2_MEDIA_SIZE_LIMITS.image),
              role: 'last_frame' as const,
            }]
          : []),
        ...((flags.referenceImage as string[] | undefined) ?? []).map(input => ({
          url: resolveImageInput(input, VIDEO_V2_MEDIA_SIZE_LIMITS.image),
          role: 'reference_image' as const,
        })),
      ];

      try {
        body = buildVideoV2Request({
          prompt,
          images,
          referenceVideos: ((flags.referenceVideo as string[] | undefined) ?? [])
            .map(input => resolveMediaInput(input, 'video')),
          referenceAudios: ((flags.referenceAudio as string[] | undefined) ?? [])
            .map(input => resolveMediaInput(input, 'audio')),
          duration: flags.duration as number | undefined,
          ratio: flags.ratio as string | undefined,
          callbackUrl: flags.callbackUrl as string | undefined,
        });
      } catch (error) {
        if (error instanceof VideoV2InputError) {
          throw new CLIError(
            error.message,
            ExitCode.USAGE,
            'mmx video generate --model MiniMax-H3 --prompt <text>',
          );
        }
        throw error;
      }
    } else {
      if (hasV2OnlyInput) {
        throw new CLIError(
          '--reference-image, --reference-video, --reference-audio, --duration, and --ratio require --model MiniMax-H3.',
          ExitCode.USAGE,
        );
      }

      body = { model, prompt };

      if (inputImage) {
        body.first_frame_image = resolveImageInput(inputImage);
      }

      if (flags.lastFrame) {
        if (!inputImage) {
          throw new CLIError(
            '--last-frame requires --image (SEF mode).',
            ExitCode.USAGE,
            'mmx video generate --prompt <text> --image <path> --last-frame <path>',
          );
        }
        body.last_frame_image = resolveImageInput(flags.lastFrame as string);
      }

      if (flags.subjectImage) {
        body.subject_reference = [{ type: 'character', image: [resolveImageInput(flags.subjectImage as string)] }];
      }

      if (flags.callbackUrl) body.callback_url = flags.callbackUrl as string;
    }

    if (dryRun(config, body)) return;

    const format = detectOutputFormat(config.output);
    const usesV2 = isVideoV2Request(body);
    const url = usesV2
      ? videoGenerateV2Endpoint(config.baseUrl)
      : videoGenerateEndpoint(config.baseUrl);
    const response = await requestJson<VideoResponse | VideoV2Response>(config, {
      url,
      method: 'POST',
      body,
    });

    const taskId = response.task_id;

    if (!config.quiet) {
      process.stderr.write(`[Model: ${model}]\n`);
    }

    // --no-wait or --async: return task ID immediately
    if (flags.noWait || config.async) {
      process.stdout.write(JSON.stringify({ taskId }));
      process.stdout.write('\n');
      return;
    }

    // Default: poll until completion
    const pollInterval = (flags.pollInterval as number) ?? 5;
    let downloadUrl: string | undefined;
    let fileId: string | undefined;
    let status: string;

    if (usesV2) {
      const taskUrl = videoTaskV2Endpoint(config.baseUrl, taskId);
      const result = await poll<VideoV2TaskResponse>(config, {
        url: taskUrl,
        intervalSec: pollInterval,
        timeoutSec: config.timeout,
        isComplete: (d) => (d as VideoV2TaskResponse).task.status === 'succeeded',
        isFailed: (d) => ['failed', 'cancelled', 'expired'].includes((d as VideoV2TaskResponse).task.status),
        getStatus: (d) => (d as VideoV2TaskResponse).task.status,
      });
      status = result.task.status;
      downloadUrl = result.task.content?.url;
    } else {
      const taskUrl = videoTaskEndpoint(config.baseUrl, taskId);
      const result = await poll<VideoTaskResponse>(config, {
        url: taskUrl,
        intervalSec: pollInterval,
        timeoutSec: config.timeout,
        isComplete: (d) => (d as VideoTaskResponse).status === 'Success',
        isFailed: (d) => (d as VideoTaskResponse).status === 'Failed',
        getStatus: (d) => (d as VideoTaskResponse).status,
      });
      status = result.status;
      fileId = result.file_id;

      if (!fileId) {
        throw new CLIError(
          'Task completed but no file_id returned.',
          ExitCode.GENERAL,
        );
      }

      const fileInfo = await requestJson<FileRetrieveResponse>(config, {
        url: fileRetrieveEndpoint(config.baseUrl, fileId),
      });
      downloadUrl = fileInfo.file?.download_url;
    }

    if (!downloadUrl) {
      throw new CLIError(
        'No download URL available for this file.',
        ExitCode.GENERAL,
      );
    }

    // --download: save to file
    if (flags.download) {
      const destPath = flags.download as string;
      const { size } = await downloadFile(downloadUrl, destPath, { quiet: config.quiet });

      if (config.quiet) {
        console.log(destPath);
      } else {
        console.log(formatOutput({
          task_id: taskId,
          status,
          file_id: fileId,
          saved: destPath,
          size: formatBytes(size),
        }, format));
      }
      return;
    }

    // Default: auto-download to temp location and output local file path
    const os = await import('os');
    const { join } = await import('path');
    const destDir = join(os.tmpdir(), 'mmx-video');
    const { existsSync, mkdirSync } = await import('fs');
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, `${taskId}.mp4`);

    await downloadFile(downloadUrl, destPath, { quiet: config.quiet });

    process.stdout.write(destPath);
    process.stdout.write('\n');
  },
});
