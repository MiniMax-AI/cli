import { Client } from "../client";
import { fileRetrieveEndpoint, videoGenerateEndpoint, videoTaskEndpoint } from "../../client/endpoints";
import { FileRetrieveResponse, VideoRequest, VideoResponse, VideoTaskResponse } from "../../types/api";
import { ModelPartial } from "../types";
import { poll } from "../../polling/poll";
import { downloadFile } from "../../files/download";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from 'es-toolkit/object';

export interface VideoAsyncGenerateRequest extends ModelPartial<VideoRequest> {
  async?: boolean;
  pollInterval?: number;
  timeout?: number;
}

export interface VideoDownloadRequest {
  fileId: string;
  outPath: string;
}

export class VideoSDK extends Client {
  async generate(request: VideoAsyncGenerateRequest & { async: true }): Promise<{taskId: string}>;
  async generate(request: ModelPartial<VideoAsyncGenerateRequest>): Promise<VideoResponse>;
  async generate(request: VideoAsyncGenerateRequest): Promise<VideoResponse | {taskId: string}> {
    const body = this.validateParams(request);
    const url = videoGenerateEndpoint(this.config.baseUrl);
    const res = await this.requestJson<VideoResponse>({
      url,
      method: "POST",
      body,
    });

    const taskId = res.task_id;
    if (request.async) {
      return {taskId};
    }

    const taskUrl = videoTaskEndpoint(this.config.baseUrl, taskId);
    const result = await poll<VideoTaskResponse>(this.config, {
      url: taskUrl,
      intervalSec: request.pollInterval ?? 5,
      timeoutSec: request.timeout ?? this.config.timeout,
      isComplete: (d) => (d as VideoTaskResponse).status === 'Success',
      isFailed: (d) => (d as VideoTaskResponse).status === 'Failed',
      getStatus: (d) => (d as VideoTaskResponse).status,
    });

    return result;
  }

  async getTask({taskId}: {taskId: string}): Promise<VideoTaskResponse> {
    const url = videoTaskEndpoint(this.config.baseUrl, taskId);
    return await this.requestJson<VideoTaskResponse>({ url });
  }

  async download(request: VideoDownloadRequest) {
    const url = fileRetrieveEndpoint(this.config.baseUrl, request.fileId);
    const fileInfo = await this.requestJson<FileRetrieveResponse>({ url });
    const downloadUrl = fileInfo.file?.download_url;
    if (!downloadUrl) {
      throw new SDKError('No download URL available for this file.', ExitCode.GENERAL);
    }
    const { size } = await downloadFile(downloadUrl, request.outPath, { quiet: true });
    return {
      size,
      save: request.outPath,
      downloadUrl,
    }
  }

  private validateParams(request: VideoAsyncGenerateRequest): VideoRequest {
    const { prompt, model, first_frame_image, last_frame_image, subject_reference } = request;

    if (!prompt) {
      throw new SDKError('prompt is required', ExitCode.USAGE);
    }
    let resolvedModel: string
    if (model) {
      resolvedModel = model;
    } else if (last_frame_image) {
      resolvedModel = 'MiniMax-Hailuo-02';
    } else if (subject_reference) {
      resolvedModel = 'S2V-01';
    } else {
      resolvedModel = 'MiniMax-Hailuo-2.3';
    }

    if (resolvedModel === 'MiniMax-Hailuo-2.3-Fast' && !first_frame_image) {
      throw new SDKError(
        'MiniMax-Hailuo-2.3-Fast only supports I2V (image-to-video). Provide first_frame_image.',
        ExitCode.USAGE,
      );
    }

    if (last_frame_image && !first_frame_image) {
      throw new SDKError(
        'last_frame_image requires first_frame_image (SEF mode).',
        ExitCode.USAGE,
      );
    }

    if (last_frame_image && subject_reference) {
      throw new SDKError(
        'last_frame_image and subject_reference cannot be used together (SEF and S2V are different modes).',
        ExitCode.USAGE,
      );
    }

    return toMerged({
      model: resolvedModel,
    }, request)
  }
}
