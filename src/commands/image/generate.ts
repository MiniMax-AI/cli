import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { imageEditsEndpoint, imageEndpoint, imageGenerationsEndpoint } from '../../client/endpoints';
import { downloadFile } from '../../files/download';
import { formatOutput, detectOutputFormat, dryRun } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { ImageH3Request, ImageH3Response, ImageRequest, ImageResponse } from '../../types/api';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { localFileToDataUri } from '../../utils/image';
import { promptOrFail } from '../../utils/prompt';
import {
  buildImageH3Request,
  IMAGE_H3_MIN_TIMEOUT_SEC,
  IMAGE_H3_MODEL,
  imageH3Extension,
  ImageH3InputError,
  isImageH3EditRequest,
  isImageH3Model,
  resolveImageH3Input,
  saveImageH3Images,
} from '../../image/h3';

const H3_HINT = 'mmx image generate --model MiniMax-H3-Image --prompt <text>';

/** Flags only understood by MiniMax-H3-Image (camelCase key → CLI spelling). */
const H3_ONLY_FLAGS: Array<[string, string]> = [
  ['image', '--image'],
  ['size', '--size'],
  ['area', '--area'],
  ['outputFormat', '--output-format'],
  ['outputCompression', '--output-compression'],
  ['noPromptEnhance', '--no-prompt-enhance'],
];

/** Flags only understood by the legacy image-01 endpoint. */
const LEGACY_ONLY_FLAGS: Array<[string, string]> = [
  ['seed', '--seed'],
  ['promptOptimizer', '--prompt-optimizer'],
  ['subjectRef', '--subject-ref'],
];

function usedFlags(flags: GlobalFlags, defs: Array<[string, string]>): string[] {
  const record = flags as Record<string, unknown>;
  return defs
    .filter(([key]) => record[key] !== undefined && record[key] !== false)
    .map(([, flag]) => flag);
}

async function runImageH3(config: Config, flags: GlobalFlags, prompt: string): Promise<void> {
  const legacyOnly = usedFlags(flags, LEGACY_ONLY_FLAGS);
  if (legacyOnly.length > 0) {
    throw new CLIError(
      `${legacyOnly.join(', ')} ${legacyOnly.length > 1 ? 'are' : 'is'} not supported by ${IMAGE_H3_MODEL}.`,
      ExitCode.USAGE,
      'Use --image for reference images; prompt enhancement is on by default (--no-prompt-enhance to disable).',
    );
  }

  // --width/--height are a convenience spelling of size=WIDTHxHEIGHT.
  const width = flags.width as number | undefined;
  const height = flags.height as number | undefined;
  if ((width === undefined) !== (height === undefined)) {
    throw new CLIError('--width and --height must be specified together.', ExitCode.USAGE, H3_HINT);
  }
  let size = flags.size as string | undefined;
  if (width !== undefined && height !== undefined) {
    if (size !== undefined) {
      throw new CLIError('Use either --size or --width/--height, not both.', ExitCode.USAGE, H3_HINT);
    }
    size = `${width}x${height}`;
  }

  const outPath = flags.out as string | undefined;
  if (outPath && (flags.n as number) > 1) {
    throw new CLIError('--out cannot be used with --n > 1. Use --out-dir instead.', ExitCode.USAGE);
  }

  let body: ImageH3Request;
  try {
    const images = ((flags.image as string[] | undefined) ?? []).map(resolveImageH3Input);
    body = buildImageH3Request({
      prompt,
      images,
      n: flags.n as number | undefined,
      size,
      aspectRatio: flags.aspectRatio as string | undefined,
      area: flags.area as string | undefined,
      outputFormat: flags.outputFormat as string | undefined,
      outputCompression: flags.outputCompression as number | undefined,
      responseFormat: flags.responseFormat as string | undefined,
      disablePromptEnhanced: flags.noPromptEnhance === true,
      aigcWatermark: flags.aigcWatermark === true,
    });
  } catch (error) {
    if (error instanceof ImageH3InputError) {
      throw new CLIError(error.message, ExitCode.USAGE, H3_HINT);
    }
    throw error;
  }

  if (dryRun(config, body)) return;

  const format = detectOutputFormat(config.output);
  const isEdit = isImageH3EditRequest(body);
  const response = await requestJson<ImageH3Response>(config, {
    url: isEdit ? imageEditsEndpoint(config.baseUrl) : imageGenerationsEndpoint(config.baseUrl),
    method: 'POST',
    body,
    // Not idempotent: timing out early still bills the images, so wait as long as the server.
    timeout: Math.max(config.timeout, IMAGE_H3_MIN_TIMEOUT_SEC),
  });

  if (!config.quiet) {
    process.stderr.write(`[Model: ${IMAGE_H3_MODEL}${isEdit ? ' (edit)' : ''}]\n`);
  }

  const { saved, failures } = await saveImageH3Images(response, {
    out: outPath,
    outDir: flags.outDir as string | undefined,
    prefix: flags.outPrefix as string | undefined,
    quiet: config.quiet,
    warnOverwrite: true,
  });

  // Always reported, even with --quiet: a missing image is a result, not progress noise.
  for (const failure of failures) {
    process.stderr.write(
      `Warning: image ${failure.index + 1} failed${failure.code ? ` (${failure.code})` : ''}: ${failure.message ?? 'unknown error'}\n`,
    );
  }

  if (outPath && saved.length > 0) {
    const expected = imageH3Extension(response.output_format);
    const actual = extname(outPath).toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg');
    if (actual !== expected) {
      process.stderr.write(`Warning: --out ${outPath} has a .${actual || '(none)'} extension but the image is ${expected}.\n`);
    }
  }

  const result: Record<string, unknown> = {
    id: response.request_id,
    saved,
    success_count: saved.length,
    failed_count: failures.length,
  };
  if (failures.length > 0) result.failures = failures;

  if (format === 'json') {
    result.sizes = response.data.map(item => item.size ?? null);
    result.revised_prompts = response.data.map(item => item.revised_prompt ?? null);
    if (response.usage) result.usage = response.usage;
    console.log(formatOutput(result, format));
  } else if (config.quiet) {
    console.log(saved.join('\n'));
  } else {
    console.log(formatOutput(result, format));
  }
}

export default defineCommand({
  name: 'image generate',
  description: 'Generate or edit images (image-01 / MiniMax-H3-Image)',
  apiDocs: '/docs/api-reference/image-generation-t2i',
  usage: 'mmx image generate --prompt <text> [flags]',
  options: [
    { flag: '--model <model>', description: 'Model ID: image-01 (default), image-01-live, or MiniMax-H3-Image. Other values are passed to the image-01 endpoint as-is.' },
    { flag: '--prompt <text>', description: 'Image description', required: true },
    { flag: '--image <path-or-url>', description: 'H3: reference image for image editing (repeatable, 1-16; local file, URL, data URI, or mm_file:// ID).', type: 'array' },
    { flag: '--aspect-ratio <ratio>', description: 'Aspect ratio (e.g. 16:9, 1:1). image-01: ignored if --width and --height are both specified. H3: auto or X:Y (integers 1-300) between 1:3 and 3:1; cannot be combined with --size/--width/--height.' },
    { flag: '--size <WxH>', description: 'H3: output size, auto (default) or WIDTHxHEIGHT (e.g. 2720x1536). Cannot be combined with --aspect-ratio/--area.' },
    { flag: '--area <level>', description: 'H3: area level 1K, 2K, or 4K (default: 4K).' },
    { flag: '--output-format <fmt>', description: 'H3: jpg (default), png, or webp.' },
    { flag: '--output-compression <q>', description: 'H3: JPEG/WEBP quality 0-100 (default: 95).', type: 'number' },
    { flag: '--no-prompt-enhance', description: 'H3 text-to-image: disable prompt enhancement (requires --size or a concrete --aspect-ratio).' },
    { flag: '--n <count>', description: 'Number of images to generate (default: 1; H3: 1-10)', type: 'number' },
    { flag: '--seed <n>', description: 'Random seed for reproducible generation (same seed + prompt = identical output)', type: 'number' },
    { flag: '--width <px>', description: 'Custom width in pixels. image-01: range [512, 2048], multiple of 8, overrides --aspect-ratio. H3: shorthand for --size WIDTHxHEIGHT.', type: 'number' },
    { flag: '--height <px>', description: 'Custom height in pixels. image-01: range [512, 2048], multiple of 8, overrides --aspect-ratio. H3: shorthand for --size WIDTHxHEIGHT.', type: 'number' },
    { flag: '--prompt-optimizer', description: 'Automatically optimize the prompt before generation for better results.' },
    { flag: '--aigc-watermark', description: 'Embed AI-generated content watermark in the output image.' },
    { flag: '--subject-ref <params>', description: 'Subject reference for character consistency. Format: type=character,image=path-or-url' },
    { flag: '--out <path>', description: 'Save image to exact file path (single image only)' },
    { flag: '--response-format <format>', description: 'Response format: url (download), base64 (embed). Default: url. H3 also accepts b64_json; total area n x W x H is limited to 20 MP (png) or 80 MP (jpg/webp).' },
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
    '# MiniMax-H3-Image text-to-image',
    'mmx image generate --model MiniMax-H3-Image --prompt "An orange cat on a sunny windowsill" --aspect-ratio 16:9 --area 2K',
    'mmx image generate --model MiniMax-H3-Image --prompt "Poster" --size 2720x1536 --output-format png',
    '# MiniMax-H3-Image image editing (1-16 reference images)',
    'mmx image generate --model MiniMax-H3-Image --prompt "Replace the cat in Picture 1 with the dog in Picture 2" --image cat.jpg --image https://example.com/dog.png',
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

    const model = (flags.model as string | undefined) || 'image-01';
    if (isImageH3Model(model)) {
      await runImageH3(config, flags, prompt);
      return;
    }

    const h3Only = usedFlags(flags, H3_ONLY_FLAGS);
    if (h3Only.length > 0) {
      throw new CLIError(
        `${h3Only.join(', ')} ${h3Only.length > 1 ? 'require' : 'requires'} --model ${IMAGE_H3_MODEL}.`,
        ExitCode.USAGE,
        H3_HINT,
      );
    }

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
      model,
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
      process.stderr.write(`[Model: ${model}]\n`);
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
