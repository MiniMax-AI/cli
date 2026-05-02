import { Client } from "../client";
import { vlmEndpoint } from "../../client/endpoints";
import { toDataUri } from "../../commands/vision/describe";

export interface VlmResponse {
  content: string;
}

export interface ImageDescribeRequest {
  prompt?: string;
  image: string;
}

export class VisionSDK extends Client {
  async describe(request: ImageDescribeRequest): Promise<VlmResponse> {
    const body = {
      prompt: request.prompt || 'Describe the image.',
      image_url: await toDataUri(request.image),
    };

    const url = vlmEndpoint(this.config.baseUrl);
    const res = await this.requestJson<VlmResponse>({
      url,
      method: 'POST',
      body,
    });

    return res;
  }
}
