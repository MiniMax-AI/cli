import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Client } from "../client";
import {
  speechAsyncEndpoint,
  speechAsyncFileEndpoint,
  speechAsyncQueryEndpoint,
  speechEndpoint,
  speechWsEndpoint,
  voicesEndpoint,
} from "../../client/endpoints";
import {
  SpeechAsyncQueryResponse,
  SpeechAsyncQueryRequest,
  SpeechAsyncRequest,
  SpeechAsyncResponse,
  SpeechRequest,
  SpeechResponse,
  VoiceListResponse,
} from "../../types/api";
import { filterByLanguage } from "../../commands/speech/voices";
import { resolveCredential } from "../../auth/resolver";
import { ttsWebSocketAudioStream, type SpeechWebSocketRequest } from "../../utils/tts-websocket";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from "es-toolkit/object";
import { ModelPartial } from "../types";

function hexToBuffer(hex: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new SDKError('API returned invalid audio data (not valid hex).', ExitCode.GENERAL);
  }
  if (hex.length % 2 !== 0) {
    throw new SDKError('API returned truncated audio data (odd-length hex string).', ExitCode.GENERAL);
  }
  return Buffer.from(hex, 'hex');
}

function defaultFilename(prefix: string, ext: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `${prefix}_${ts}.${ext}`;
}

const DIRECT_ASYNC_TEXT_LIMIT = 50_000;

export class SpeechSDK extends Client {
  async synthesize(request: ModelPartial<SpeechRequest> & { stream: true }): Promise<AsyncGenerator<SpeechResponse>>;
  async synthesize(request: ModelPartial<SpeechRequest>): Promise<SpeechResponse>;
  async synthesize(request: ModelPartial<SpeechRequest>): Promise<SpeechResponse | AsyncGenerator<SpeechResponse>> {
    const body = this.validateParams(request);

    const url = speechEndpoint(this.config.baseUrl);

    if (body.stream) {
      return this.synthesizeStream(body, url);
    }

    const res = await this.requestJson<SpeechResponse>({
      url,
      method: "POST",
      body,
    });

    return res;
  }

  private async *synthesizeStream(body: SpeechRequest, url: string): AsyncGenerator<SpeechResponse> {
    const res = await this.request({
      url,
      method: "POST",
      body,
      stream: true,
    });

    yield* this.streamSSE<SpeechResponse>(res);
  }

  async voices(language?: string) {
    const url = voicesEndpoint(this.config.baseUrl);

    const res = await this.requestJson<VoiceListResponse>({
      url,
      method: "POST",
      body: { voice_type: 'system' },
    });

    const voices = res.system_voice ?? [];
    if (language) {
      const filtered = filterByLanguage(voices, language);
      return filtered;
    }
    return voices;
  }

  /**
   * Create an asynchronous TTS task. The task is processed in the background
   * and can be polled with `queryAsync()`. Supports long-form text (up to
   * 1M characters).
   *
   * @param request — Model, text or text_file_id, voice and audio settings.
   * @returns The created task, including its `task_id` and `file_id`.
   */
  async createAsync(request: ModelPartial<SpeechAsyncRequest>): Promise<SpeechAsyncResponse> {
    const body = this.validateAsyncParams(request);
    const url = speechAsyncEndpoint(this.config.baseUrl);
    return this.requestJson<SpeechAsyncResponse>({
      url,
      method: 'POST',
      body,
    });
  }

  /**
   * Query the status of an asynchronous TTS task created with `createAsync()`.
   *
   * @param taskId — The task ID returned by `createAsync()`.
   * @returns The current task status (`Processing`, `Success`, `Failed`, or
   *          `Expired`) and, when complete, the resulting `file_id`.
   */
  async queryAsync(taskId: string | number): Promise<SpeechAsyncQueryResponse> {
    const body: SpeechAsyncQueryRequest = { task_id: taskId };
    return this.requestJson<SpeechAsyncQueryResponse>({
      url: speechAsyncQueryEndpoint(this.config.baseUrl),
      method: 'POST',
      body,
    });
  }

  /**
   * Download the audio produced by a completed asynchronous TTS task.
   *
   * @param fileId  — The `file_id` returned by `queryAsync()`.
   * @param outPath — Target file path. Defaults to `speech_<timestamp>.mp3`.
   * @returns The absolute path of the saved file.
   */
  async downloadAsyncFile(fileId: string | number, outPath?: string, ext = 'mp3'): Promise<string> {
    const dest = resolve(outPath || defaultFilename('speech', ext));
    const url = speechAsyncFileEndpoint(this.config.baseUrl, fileId);
    const res = await this.request({ url });

    const data = new Uint8Array(await res.arrayBuffer());
    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    try {
      writeFileSync(dest, data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new SDKError('Disk full — cannot write audio file.', ExitCode.GENERAL);
      }
      throw err;
    }

    return dest;
  }

  async synthesizeWebSocket(request: ModelPartial<SpeechRequest> & { stream: true }): Promise<AsyncGenerator<Uint8Array>>;
  async synthesizeWebSocket(request: ModelPartial<SpeechRequest>): Promise<Buffer>;
  async synthesizeWebSocket(request: ModelPartial<SpeechRequest>): Promise<Buffer | AsyncGenerator<Uint8Array>> {
    const params = this.validateParams(request);
    const wsRequest: SpeechWebSocketRequest = {
      model: params.model,
      text: params.text,
    };
    if (params.voice_setting) wsRequest.voice_setting = params.voice_setting;
    if (params.audio_setting) wsRequest.audio_setting = params.audio_setting;
    if (params.language_boost) wsRequest.language_boost = params.language_boost;
    if (params.pronunciation_dict) wsRequest.pronunciation_dict = params.pronunciation_dict;

    const credential = await resolveCredential(this.config);
    const url = speechWsEndpoint(this.config.baseUrl);

    const stream = ttsWebSocketAudioStream(url, credential.token, wsRequest);
    if (params.stream) return stream;

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Save synthesized speech audio to a file. Decodes the hex-encoded audio
   * from the API response and writes it to disk. Creates intermediate
   * directories as needed.
   *
   * @param response — The response from `synthesize()`.
   * @param outPath  — Target file path. Defaults to `speech_<timestamp>.mp3`.
   * @param ext      — File extension (default: `"mp3"`).
   * @returns The absolute path of the saved file.
   */
  save(response: SpeechResponse, outPath?: string, ext = 'mp3'): string {
    const dest = resolve(outPath || defaultFilename('speech', ext));
    const audioHex = response.data.audio;
    if (!audioHex) {
      throw new SDKError('API response missing audio data.', ExitCode.GENERAL);
    }

    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    try {
      writeFileSync(dest, hexToBuffer(audioHex));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new SDKError('Disk full — cannot write audio file.', ExitCode.GENERAL);
      }
      throw err;
    }

    return dest;
  }

  private validateParams(params: Partial<SpeechRequest>): SpeechRequest {
    if (!params.text) {
      throw new SDKError('text is required', ExitCode.USAGE);
    }

    return toMerged({
      model: "speech-2.8-hd",
      voice_setting: {
        voice_id:"English_expressive_narrator",
      },
      audio_setting: {
        format: "mp3",
        sample_rate: 32000,
        bitrate: 128000,
        channel: 1,
      },
      output_format: 'hex',
    }, params) as SpeechRequest;
  }

  private validateAsyncParams(params: Partial<SpeechAsyncRequest>): SpeechAsyncRequest {
    if (!params.text && !params.text_file_id) {
      throw new SDKError('text or text_file_id is required', ExitCode.USAGE);
    }
    if (params.text && params.text_file_id) {
      throw new SDKError('provide either text or text_file_id, not both', ExitCode.USAGE);
    }
    if (params.text && params.text.length > DIRECT_ASYNC_TEXT_LIMIT) {
      throw new SDKError(
        'text is limited to 50,000 characters; upload longer input with purpose t2a_async_input and use text_file_id',
        ExitCode.USAGE,
      );
    }

    return toMerged({
      model: "speech-2.8-hd",
      voice_setting: {
        voice_id: "English_expressive_narrator",
      },
      audio_setting: {
        format: "mp3",
        audio_sample_rate: 32000,
        bitrate: 128000,
        channel: 1,
      },
    }, params) as SpeechAsyncRequest;
  }
}
