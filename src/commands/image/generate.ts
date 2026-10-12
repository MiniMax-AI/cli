import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { imageEndpoint } from '../../client/endpoints';
import { downloadFile } from '../../files/download';
import { formatOutput, detectOutputFormat, dryRun } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { ImageRequest, ImageResponse } from '../../types/api';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { localFileToDataUri } from '../../utils/image';
import { promptOrFail } from '../../utils/prompt';

export default defineCommand({
  name: 'image generate',
  description: 'Generate images (image-01 / image-01-live)',
  apiDocs: '/docs/api-reference/image-generation-t2i',
  usage: 'mmx image generate --prompt <text> [flags]',
  options: [
    { flag: '--prompt <text>', description: 'Image description', required: true },
    { flag: '--aspect-ratio <ratio>', description: 'Aspect ratio (e.g. 16:9, 1:1). Ignored if --width and --height are both specified.' },
    { flag: '--n <count>', description: 'Number of images to generate (default: 1)', type: 'number' },
    { flag: '--seed <n>', description: 'Random seed for reproducible generation (same seed + prompt = identical output)', type: 'number' },
    { flag: '--width <px>', description: 'Custom width in pixels. Range [512, 2048], must be multiple of 8. Only effective for image-01 model. Overrides --aspect-ratio if set.', type: 'number' },
    { flag: '--height <px>', description: 'Custom height in pixels. Range [512, 2048], must be multiple of 8. Only effective for image-01 model. Overrides --aspect-ratio if set.', type: 'number' },
    { flag: '--prompt-optimizer', description: 'Automatically optimize the prompt before generation for better results.' },
    { flag: '--aigc-watermark', description: 'Embed AI-generated content watermark in the output image.' },
    { flag: '--subject-ref <params>', description: 'Subject reference for character consistency. Format: type=character,image=path-or-url' },
    { flag: '--out <path>', description: 'Save image to exact file path (single image only)' },
    { flag: '--response-format <format>', description: 'Response format: url (download), base64 (embed). Default: url' },
    { flag: '--out-dir <dir>', description: 'Download images to directory' },
    { flag: '--out-prefix <prefix>', description: 'Filename prefix (default: image)' },
  ],
  examples: [
    'mmx image generate --prompt "A cat in a spacesuit on Mars" --aspect-ratio 16:9',
    'mmx image generate --prompt "Logo design" --n 3 --out-dir ./generated/',
    'mmx image generate --prompt "Mountain landscape" --quiet',
    '# Reproducible output with seed',
    'mmx image generate --prompt "A castle" --seed 42',
    '# Custom dimensions (must be 512–2048, multiple of 8)',
    'mmx image generate --prompt "Wide landscape" --width 1920 --height 1080',
    '# Optimized prompt with watermark',
    'mmx image generate --prompt "sunset" --prompt-optimizer --aigc-watermark',
    '# Save to exact path',
    'mmx image generate --prompt "A cat" --out /tmp/cat.jpg',
    '# Base64 response (bypasses CDN, useful when image URLs are unreachable)',
    'mmx image generate --prompt "A cat" --response-format base64',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = (flags.prompt ?? (flags._positional as string[]|undefined)?.[0]) as string | undefined;

    prompt = await promptOrFail({
      value: prompt,
      message: 'Enter your image prompt:',
      cancelMessage: 'Image generation cancelled.',
      flagName: 'prompt',
      usageHint: 'mmx image generate --prompt <text>',
      nonInteractive: config.nonInteractive,
    });

    // Validate width/height
    const width = flags.width as number | undefined;
    const height = flags.height as number | undefined;

    if (width !== undefined && height === undefined) {
      throw new CLIError('--width requires --height. Both must be specified together.', ExitCode.USAGE);
    }
    if (height !== undefined && width === undefined) {
      throw new CLIError('--height requires --width. Both must be specified together.', ExitCode.USAGE);
    }
    if (width !== undefined && height !== undefined) {
      const validateSize = (name: string, val: number) => {
        if (val < 512 || val > 2048) {
          throw new CLIError(`--${name} must be between 512 and 2048, got ${val}.`, ExitCode.USAGE);
        }
        if (val % 8 !== 0) {
          throw new CLIError(`--${name} must be a multiple of 8, got ${val}.`, ExitCode.USAGE);
        }
      };
      validateSize('width', width);
      validateSize('height', height);
    }

    const outPath = flags.out as string | undefined;
    if (outPath && (flags.n as number) > 1) {
      throw new CLIError('--out cannot be used with --n > 1. Use --out-dir instead.', ExitCode.USAGE);
    }

    const responseFormat = (flags.responseFormat as 'url' | 'base64' | undefined) || 'url';

    const body: ImageRequest = {
      model: 'image-01',
      prompt,
      aspect_ratio: (width !== undefined && height !== undefined) ? undefined : ((flags.aspectRatio as string) || undefined),
      n: (flags.n as number) ?? 1,
      seed: flags.seed as number | undefined,
      width: width,
      height: height,
      prompt_optimizer: flags.promptOptimizer === true || undefined,
      aigc_watermark: flags.aigcWatermark === true || undefined,
      response_format: responseFormat,
    };

    if (flags.subjectRef) {
      const refStr = flags.subjectRef as string;
      const params = Object.fromEntries(
        refStr.split(',').map(p => {
        const eqIdx = p.indexOf('=');
        if (eqIdx === -1) return [p, ''];
        return [p.slice(0, eqIdx), p.slice(eqIdx + 1)];
      }),
      );

      const ref: { type: string; image_url?: string; image_file?: string } = {
        type: params.type || 'character',
      };

      if (params.image) {
        if (params.image.startsWith('http')) {
          ref.image_url = params.image;
        } else {
          ref.image_file = localFileToDataUri(resolve(params.image));
        }
      }

      body.subject_reference = [ref];
    }

    if (dryRun(config, body)) return;

    const format = detectOutputFormat(config.output);
    const url = imageEndpoint(config.baseUrl);
    const response = await requestJson<ImageResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    if (!config.quiet) {
      process.stderr.write('[Model: image-01]\n');
    }

    // The API answers 200 with an empty image list when every image is rejected.
    // Without this check the command reports the --out path as saved and exits 0
    // even though nothing was written (see ERRORS.md, `mmx image generate`).
    if (response.data.success_count === 0) {
      throw new CLIError(
        'Image generation failed: all images were rejected (content policy or model error).',
        ExitCode.GENERAL,
      );
    }

    const saved: string[] = [];

    if (outPath) {
      const dir = dirname(resolve(outPath));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const destPath = resolve(outPath);
      if (existsSync(destPath)) {
        process.stderr.write(`Warning: overwriting existing file: ${destPath}\n`);
      }
      if (responseFormat === 'base64') {
        const image = (response.data.image_base64 || [])[0];
        if (image) writeFileSync(destPath, image, 'base64');
      } else {
        const imageUrl = (response.data.image_urls || [])[0];
        if (imageUrl) await downloadFile(imageUrl, destPath, { quiet: config.quiet });
      }
      saved.push(destPath);
    } else {
      const outDir = (flags.outDir as string | undefined) ?? '.';
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const prefix = (flags.outPrefix as string) || 'image';

      if (responseFormat === 'base64') {
        const images = response.data.image_base64 || [];
        for (let i = 0; i < images.length; i++) {
          const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`;
          const destPath = join(outDir, filename);
          if (existsSync(destPath)) {
            process.stderr.write(`Warning: overwriting existing file: ${destPath}\n`);
          }
          writeFileSync(destPath, images[i]!, 'base64');
          saved.push(destPath);
        }
      } else {
        const imageUrls = response.data.image_urls || [];
        for (let i = 0; i < imageUrls.length; i++) {
          const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`;
          const destPath = join(outDir, filename);
          if (existsSync(destPath)) {
            process.stderr.write(`Warning: overwriting existing file: ${destPath}\n`);
          }
          await downloadFile(imageUrls[i]!, destPath, { quiet: config.quiet });
          saved.push(destPath);
        }
      }
    }

    // --output json is respected even in --quiet mode (JSON is the actual output, not progress)
    if (format === 'json') {
      console.log(formatOutput({
        id: response.data.task_id,
        saved,
        success_count: response.data.success_count,
        failed_count: response.data.failed_count,
      }, format));
    } else if (config.quiet) {
      // Non-JSON quiet mode: just print file paths
      console.log(saved.join('\n'));
    } else {
      console.log(formatOutput({
        id: response.data.task_id,
        saved,
        success_count: response.data.success_count,
        failed_count: response.data.failed_count,
      }, format));
    }
  },
});
