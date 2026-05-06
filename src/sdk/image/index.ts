import { Client } from "../client";
import { imageEndpoint } from "../../client/endpoints";
import { ImageRequest, ImageResponse } from "../../types/api";
import { ModelPartial } from "../types";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from 'es-toolkit/object';

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
