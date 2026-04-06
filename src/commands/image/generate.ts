import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { imageEndpoint } from '../../client/endpoints';
import { downloadFile } from '../../files/download';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { ImageRequest, ImageResponse } from '../../types/api';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';

export default defineCommand({
  name: 'image generate',
  description: 'Generate images (image-01)',
  usage: 'minimax image generate --prompt <text> [flags]',
  options: [
    { flag: '--prompt <text>', description: 'Image description', required: true },
    { flag: '--aspect-ratio <ratio>', description: 'Aspect ratio (e.g. 16:9, 1:1)' },
    { flag: '--n <count>', description: 'Number of images to generate (default: 1)', type: 'number' },
    { flag: '--subject-ref <params>', description: 'Subject reference (type=character,image=path)' },
    { flag: '--out-dir <dir>', description: 'Download images to directory' },
    { flag: '--out-prefix <prefix>', description: 'Filename prefix (default: image)' },
  ],
  examples: [
    'minimax image generate --prompt "A cat in a spacesuit on Mars" --aspect-ratio 16:9',
    'minimax image generate --prompt "Logo design" --n 3 --out-dir ./generated/',
    'minimax image generate --prompt "Mountain landscape" --quiet',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = (flags.prompt ?? (flags._positional as string[]|undefined)?.[0]) as string | undefined;

    if (!prompt) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const hint = await promptText({
          message: 'Enter your image prompt:',
        });
        if (!hint) {
          process.stderr.write('Image generation cancelled.\n');
          process.exit(1);
        }
        prompt = hint;
      } else {
        failIfMissing('prompt', 'minimax image generate --prompt <text>');
      }
    }

    const body: ImageRequest = {
      model: 'image-01',
      prompt,
      aspect_ratio: (flags.aspectRatio as string) || undefined,
      n: (flags.n as number) || 1,
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
          const imgPath = resolve(params.image);
          const imgData = readFileSync(imgPath);
          ref.image_file = `data:image/jpeg;base64,${imgData.toString('base64')}`;
        }
      }

      body.subject_reference = [ref];
    }

    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      console.log(formatOutput({ request: body }, format));
      return;
    }

    const url = imageEndpoint(config.baseUrl);
    const response = await requestJson<ImageResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    const imageUrls = response.data.image_urls || [];

    if (!config.quiet) {
      process.stderr.write('[Model: image-01]\n');
    }

    // Download if --out-dir specified
    if (flags.outDir) {
      const outDir = flags.outDir as string;
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const prefix = (flags.outPrefix as string) || 'image';
      const saved: string[] = [];

      for (let i = 0; i < imageUrls.length; i++) {
        const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`;
        const destPath = join(outDir, filename);
        await downloadFile(imageUrls[i]!, destPath, { quiet: config.quiet });
        saved.push(destPath);
      }

      if (config.quiet) {
        console.log(saved.join('\n'));
      } else {
        console.log(formatOutput({
          id: response.data.task_id,
          saved,
          success_count: response.data.success_count,
          failed_count: response.data.failed_count,
        }, format));
      }
      return;
    }

    if (config.quiet) {
      console.log(imageUrls.join('\n'));
      return;
    }

    console.log(formatOutput({
      id: response.data.task_id,
      images: imageUrls,
      success_count: response.data.success_count,
      failed_count: response.data.failed_count,
    }, format));
  },
});
