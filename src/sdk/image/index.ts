import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Client } from "../client";
import { imageEditsEndpoint, imageEndpoint, imageGenerationsEndpoint } from "../../client/endpoints";
import {
  ImageH3EditRequest,
  ImageH3GenerationRequest,
  ImageH3Request,
  ImageH3Response,
  ImageRequest,
  ImageResponse,
} from "../../types/api";
import {
  IMAGE_H3_MIN_TIMEOUT_SEC,
  ImageH3InputError,
  isImageH3EditRequest,
  isImageH3Model,
  isImageH3Response,
  saveImageH3Images,
  validateImageH3Request,
} from "../../image/h3";
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

/**
 * MiniMax-H3-Image request. Without `images` it calls `/v1/images/generations`;
 * with 1-16 `images` it calls `/v1/images/edits`.
 */
export type ImageH3GenerateRequest = ImageH3GenerationRequest & {
  images?: ImageH3EditRequest['images'];
};

export class ImageSDK extends Client {
  async generate(request: ImageH3GenerateRequest): Promise<ImageH3Response>;
  async generate(request: ModelPartial<ImageRequest>): Promise<ImageResponse>;
  async generate(
    request: ModelPartial<ImageRequest> | ImageH3GenerateRequest,
  ): Promise<ImageResponse | ImageH3Response> {
    if (isImageH3Model(request.model)) {
      return await this.generateH3(request as ImageH3GenerateRequest);
    }

    const body = this.validateParams(request as ModelPartial<ImageRequest>);
    const url = imageEndpoint(this.config.baseUrl);

    return await this.requestJson<ImageResponse>({
      url,
      method: "POST",
      body,
    });
  }

  private async generateH3(request: ImageH3GenerateRequest): Promise<ImageH3Response> {
    const { images, ...rest } = request;
    if ((rest as { stream?: unknown }).stream) {
      throw new SDKError('stream is not supported by the SDK for MiniMax-H3-Image.', ExitCode.USAGE);
    }
    // Any `images` (even empty) targets edits, so an empty list fails the 1-16 check instead of silently becoming text-to-image.
    const body: ImageH3Request = images !== undefined ? { ...rest, images } : rest;

    try {
      validateImageH3Request(body);
    } catch (error) {
      if (error instanceof ImageH3InputError) throw new SDKError(error.message, ExitCode.USAGE);
      throw error;
    }

    return await this.requestJson<ImageH3Response>({
      url: isImageH3EditRequest(body)
        ? imageEditsEndpoint(this.config.baseUrl)
        : imageGenerationsEndpoint(this.config.baseUrl),
      method: "POST",
      body,
      // Not idempotent: a shorter client timeout still bills the images.
      timeout: Math.max(this.config.timeout, IMAGE_H3_MIN_TIMEOUT_SEC),
    });
  }

  /**
   * Download and save images from a `generate()` response to disk.
   *
   * Handles both `"url"` (CDN download) and `"base64"` response formats
   * and creates intermediate directories as needed. Returns the absolute
   * paths of all saved files.
   */
  async save(response: ImageResponse | ImageH3Response, options: ImageSaveOptions = {}): Promise<string[]> {
    if (isImageH3Response(response)) {
      // H3 responses carry per-item url/b64_json/error, so responseFormat is not needed.
      try {
        const { saved } = await saveImageH3Images(response, {
          out: options.out,
          outDir: options.outDir,
          prefix: options.prefix,
          quiet: options.quiet ?? true,
        });
        return saved;
      } catch (error) {
        if (error instanceof ImageH3InputError) throw new SDKError(error.message, ExitCode.USAGE);
        throw error;
      }
    }

    const fmt = options.responseFormat || 'url';
    const quiet = options.quiet ?? true;
    const saved: string[] = [];

    if (options.out) {
      // Single-image, exact path
      const images = fmt === 'base64'
        ? response.data.image_base64 || []
        : response.data.image_urls || [];

      if (images.length > 1) {
        throw new SDKError(
          'Cannot use `out` with multiple images. Use `outDir` instead.',
          ExitCode.USAGE,
        );
      }

      const image = images[0];
      if (!image?.trim()) return saved;

      const destPath = resolve(options.out);
      const dir = dirname(destPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      if (fmt === 'base64') {
        writeFileSync(destPath, image, 'base64');
      } else {
        await downloadFile(image, destPath, { quiet });
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
      aspect_ratio: (width !== undefined && height !== undefined) ? undefined : aspect_ratio,
      n: 1,
    }, params) as ImageRequest;
  }
}
