import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Client } from "../client";
import { imageEndpoint } from "../../client/endpoints";
import { ImageRequest, ImageResponse } from "../../types/api";
import { ModelPartial } from "../types";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { downloadFile } from "../../files/download";
import { toMerged } from 'es-toolkit/object';

export interface ImageSaveOptions {
  /** Save to exact file path (single image only). */
  out?: string;
  /** Save images to directory (default: "."). */
  outDir?: string;
  /** Filename prefix (default: "image"). */
  prefix?: string;
  /** Response format used by generate() — "url" or "base64" (default: "url"). */
  responseFormat?: 'url' | 'base64';
  /** Suppress progress output. */
  quiet?: boolean;
}

export class ImageSDK extends Client {
  async generate(request: ModelPartial<ImageRequest>): Promise<ImageResponse> {
    const body = this.validateParams(request);
    const url = imageEndpoint(this.config.baseUrl);

    return await this.requestJson<ImageResponse>({
      url,
      method: "POST",
      body,
    });
  }

  /**
   * Download and save images from a `generate()` response to disk.
   *
   * Handles both `"url"` (CDN download) and `"base64"` response formats
   * and creates intermediate directories as needed. Returns the absolute
   * paths of all saved files.
   */
  async save(response: ImageResponse, options: ImageSaveOptions = {}): Promise<string[]> {
    const fmt = options.responseFormat || 'url';
    const quiet = options.quiet ?? true;
    const saved: string[] = [];

    if (options.out) {
      // Single-image, exact path
      const count = (fmt === 'base64'
        ? (response.data.image_base64 || []).length
        : (response.data.image_urls || []).length);

      if (count > 1) {
        throw new SDKError(
          'Cannot use `out` with multiple images. Use `outDir` instead.',
          ExitCode.USAGE,
        );
      }

      const destPath = resolve(options.out);
      const dir = dirname(destPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      if (fmt === 'base64') {
        const image = (response.data.image_base64 || [])[0];
        if (image) writeFileSync(destPath, image, 'base64');
      } else {
        const imageUrl = (response.data.image_urls || [])[0];
        if (imageUrl) await downloadFile(imageUrl, destPath, { quiet });
      }
      saved.push(destPath);
    } else {
      // Multi-image, numbered filenames in a directory
      const outDir = resolve(options.outDir || '.');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const prefix = options.prefix || 'image';

      if (fmt === 'base64') {
        const images = response.data.image_base64 || [];
        for (let i = 0; i < images.length; i++) {
          const destPath = join(outDir, `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`);
          writeFileSync(destPath, images[i]!, 'base64');
          saved.push(destPath);
        }
      } else {
        const imageUrls = response.data.image_urls || [];
        for (let i = 0; i < imageUrls.length; i++) {
          const destPath = join(outDir, `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`);
          await downloadFile(imageUrls[i]!, destPath, { quiet });
          saved.push(destPath);
        }
      }
    }

    return saved;
  }

  private validateParams(params: Partial<ImageRequest>): ImageRequest {
    const { width, height, aspect_ratio } = params;

    if (width !== undefined || height !== undefined) {
      if (width === undefined || height === undefined) {
        throw new SDKError('Both width and height must be provided', ExitCode.USAGE);
      }
      for (const [name, val] of Object.entries({ width, height })) {
        if (val < 512 || val > 2048) {
          throw new SDKError(`${name} must be between 512 and 2048, got ${val}.`, ExitCode.USAGE);
        }
        if (val % 8 !== 0) {
          throw new SDKError(`${name} must be a multiple of 8, got ${val}.`, ExitCode.USAGE);
        }
      }
    }

    return toMerged({
      model: "image-01",
      n: 1,
    }, {
      ...params,
      aspect_ratio: (width !== undefined && height !== undefined) ? undefined : aspect_ratio,
    }) as ImageRequest;
  }
}
