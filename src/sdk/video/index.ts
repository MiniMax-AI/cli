import { Client } from "../client";
import {
  fileRetrieveEndpoint,
  videoGenerateEndpoint,
  videoGenerateV2Endpoint,
  videoTaskEndpoint,
  videoTaskV2Endpoint,
} from "../../client/endpoints";
import {
  FileRetrieveResponse,
  VideoRequest,
  VideoTaskResponse,
  VideoV2Request,
  VideoV2Response,
  VideoV2Task,
  VideoV2TaskResponse,
} from "../../types/api";
import { ModelPartial } from "../types";
import { poll } from "../../polling/poll";
import { downloadFile } from "../../files/download";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import {
  buildVideoV2Request,
  getVideoV2FailureReason,
  isVideoV2Model,
  isVideoV2Request,
  validateVideoV2Request,
  VIDEO_V2_MODEL,
  VideoV2InputError,
} from '../../video/v2';

export type VideoV2GenerateRequest = Omit<VideoV2Request, 'model' | 'resolution' | 'duration'> & {
  model?: VideoV2Request['model'];
  resolution?: VideoV2Request['resolution'];
  duration?: VideoV2Request['duration'];
};

export type VideoGenerateRequest = ModelPartial<VideoRequest> | VideoV2GenerateRequest;

export type VideoAsyncGenerateRequest = VideoGenerateRequest & {
  async?: boolean;
  pollInterval?: number;
  timeout?: number;
};

export interface VideoDownloadRequest {
  fileId: string;
  outPath: string;
}

export class VideoSDK extends Client {
  async generate(request: VideoAsyncGenerateRequest & { async: true }): Promise<{taskId: string}>;
  async generate(request: VideoAsyncGenerateRequest): Promise<VideoTaskResponse | VideoV2Task>;
  async generate(request: VideoAsyncGenerateRequest): Promise<VideoTaskResponse | VideoV2Task | {taskId: string}> {
    const body = this.validateParams(request);
    const usesV2 = isVideoV2Request(body);
    const url = usesV2
      ? videoGenerateV2Endpoint(this.config.baseUrl)
      : videoGenerateEndpoint(this.config.baseUrl);
    const res = await this.requestJson<VideoV2Response>({
      url,
      method: "POST",
      body,
    });

    const taskId = res.task_id;
    if (request.async) {
      return {taskId};
    }

    if (usesV2) {
      const taskUrl = videoTaskV2Endpoint(this.config.baseUrl, taskId);
      const result = await poll<VideoV2TaskResponse>(this.config, {
        url: taskUrl,
        intervalSec: request.pollInterval ?? 5,
        timeoutSec: request.timeout ?? this.config.timeout,
        isComplete: (d) => (d as VideoV2TaskResponse).task.status === 'succeeded',
        isFailed: (d) => ['failed', 'cancelled', 'expired'].includes((d as VideoV2TaskResponse).task.status),
        getStatus: (d) => (d as VideoV2TaskResponse).task.status,
        getFailureReason: (d) => getVideoV2FailureReason((d as VideoV2TaskResponse).task),
      });
      return result.task;
    }

    const taskUrl = videoTaskEndpoint(this.config.baseUrl, taskId);
    return await poll<VideoTaskResponse>(this.config, {
      url: taskUrl,
      intervalSec: request.pollInterval ?? 5,
      timeoutSec: request.timeout ?? this.config.timeout,
      isComplete: (d) => (d as VideoTaskResponse).status === 'Success',
      isFailed: (d) => (d as VideoTaskResponse).status === 'Failed',
      getStatus: (d) => (d as VideoTaskResponse).status,
    });
  }

  async getTask({taskId, model}: {taskId: string; model?: string}): Promise<VideoTaskResponse | VideoV2Task> {
    if (isVideoV2Model(model)) {
      const url = videoTaskV2Endpoint(this.config.baseUrl, taskId);
      const result = await this.requestJson<VideoV2TaskResponse>({ url });
      return result.task;
    }

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

  private validateParams(request: VideoAsyncGenerateRequest): VideoRequest | VideoV2Request {
    const params = { ...request } as Record<string, unknown>;
    delete params.async;
    delete params.pollInterval;
    delete params.timeout;

    if ('content' in params || isVideoV2Model(params.model as string | undefined)) {
      try {
        if ('content' in params) {
          if (params.model && !isVideoV2Model(params.model as string)) {
            throw new VideoV2InputError('content is only supported with model MiniMax-H3');
          }
          const conflictingFields = [
            'prompt',
            'first_frame_image',
            'last_frame_image',
            'subject_reference',
          ].filter(field => params[field] !== undefined);
          if (conflictingFields.length > 0) {
            throw new VideoV2InputError(
              `content cannot be combined with legacy video fields: ${conflictingFields.join(', ')}`,
            );
          }
          const content = params.content as VideoV2Request['content'];
          const hasFrameInput = content.some(item =>
            item.type === 'image_url' && (!item.role || item.role === 'first_frame' || item.role === 'last_frame'),
          );
          const hasReferenceInput = content.some(item =>
            item.type !== 'text' && item.role?.startsWith('reference_'),
          );
          const body = {
            ...params,
            model: VIDEO_V2_MODEL,
            resolution: (params.resolution ?? '2K') as '2K',
            duration: (params.duration ?? 5) as VideoV2Request['duration'],
            ratio: params.ratio ?? (hasFrameInput || hasReferenceInput ? 'adaptive' : '16:9'),
          } as VideoV2Request;
          validateVideoV2Request(body);
          return body;
        }

        const prompt = params.prompt as string | undefined;
        if (!prompt) {
          throw new VideoV2InputError('prompt or content is required');
        }
        if (params.subject_reference !== undefined) {
          throw new VideoV2InputError(
            'subject_reference is only supported by legacy video models. Use content with role reference_image for MiniMax-H3.',
          );
        }
        return buildVideoV2Request({
          prompt,
          images: [
            ...(params.first_frame_image
              ? [{ url: params.first_frame_image as string, role: 'first_frame' as const }]
              : []),
            ...(params.last_frame_image
              ? [{ url: params.last_frame_image as string, role: 'last_frame' as const }]
              : []),
          ],
          resolution: params.resolution as string | undefined,
          duration: params.duration as number | undefined,
          ratio: params.ratio as string | undefined,
          callbackUrl: params.callback_url as string | undefined,
        });
      } catch (error) {
        if (error instanceof VideoV2InputError) {
          throw new SDKError(error.message, ExitCode.USAGE);
        }
        throw error;
      }
    }

    if ('resolution' in params || 'duration' in params || 'ratio' in params) {
      throw new SDKError('resolution, duration, and ratio require model MiniMax-H3', ExitCode.USAGE);
    }

    const { prompt, model, first_frame_image, last_frame_image, subject_reference } = params as ModelPartial<VideoRequest>;

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

    return {
      ...(params as Omit<VideoRequest, 'model'>),
      model: resolvedModel,
    };
  }
}
