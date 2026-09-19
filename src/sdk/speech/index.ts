import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { Client } from "../client";
import { speechEndpoint, speechToTextEndpoint, voicesEndpoint } from "../../client/endpoints";
import {
  SpeechRequest,
  SpeechResponse,
  SpeechToTextRequest,
  SpeechToTextResponse,
  SpeechToTextStreamEvent,
  VoiceListResponse,
} from "../../types/api";
import { filterByLanguage } from "../../commands/speech/voices";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from "es-toolkit/object";
import { ModelPartial } from "../types";
import { STT_DEFAULT_MODEL, sttStreamFormatConflict } from "../../utils/stt";

export type TranscribeParams = ModelPartial<SpeechToTextRequest> & {
  /** Local audio path, or a Blob/File to send as-is. */
  file: string | Blob;
  /**
   * BCP-47 language hint (e.g. `zh`, `en`). Sent as the `language` request
   * header: the API ignores it when passed as a form field, even though its
   * curl example uses `-F "language=zh"`.
   */
  language?: string;
};

export type TranscribeStreamParams = TranscribeParams & { stream: true };

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

/** Resolve a transcription input into the multipart `file` part. */
function prepareAudioUpload(file: string | Blob): { blob: Blob; filename: string } {
  if (typeof file === 'string') {
    const fullPath = resolve(file);
    if (!existsSync(fullPath)) {
      throw new SDKError(`File not found: ${fullPath}`, ExitCode.USAGE);
    }
    return { blob: new Blob([readFileSync(fullPath)]), filename: basename(fullPath) };
  }

  const name = (file as File).name;
  return { blob: file, filename: typeof name === 'string' && name ? name : 'audio' };
}

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
   * Transcribe an audio file (speech-to-text).
   *
   * `json` and `verbose_json` resolve to a structured response; SRT and VTT are
   * returned by the API as subtitle documents, so `response_format` is applied
   * as-is and the raw body is surfaced by the caller. The audio is uploaded as
   * `multipart/form-data`, and `language` travels as a request header — the API
   * ignores it when sent as a form field.
   */
  async transcribe(params: TranscribeStreamParams): Promise<AsyncGenerator<SpeechToTextStreamEvent>>;
  async transcribe(params: TranscribeParams): Promise<SpeechToTextResponse>;
  async transcribe(
    params: TranscribeParams,
  ): Promise<SpeechToTextResponse | AsyncGenerator<SpeechToTextStreamEvent>> {
    const { file, language, model, response_format, timestamp_level, stream } = params;

    if (!file) {
      throw new SDKError('file is required', ExitCode.USAGE);
    }

    const responseFormat = response_format ?? 'json';
    const streamConflict = sttStreamFormatConflict(responseFormat, stream === true);
    if (streamConflict) {
      throw new SDKError(streamConflict, ExitCode.USAGE);
    }

    const { blob, filename } = prepareAudioUpload(file);

    const form = new FormData();
    form.append('model', model ?? STT_DEFAULT_MODEL);
    form.append('file', blob, filename);
    form.append('response_format', responseFormat);
    if (timestamp_level) form.append('timestamp_level', timestamp_level);
    if (stream) form.append('stream', 'true');

    const url = speechToTextEndpoint(this.config.baseUrl);
    const headers: Record<string, string> = {};
    if (language) headers.language = language;

    if (stream) {
      const res = await this.request({ url, method: 'POST', body: form, headers, stream: true });
      return this.streamSSE<SpeechToTextStreamEvent>(res);
    }

    return this.requestJson<SpeechToTextResponse>({ url, method: 'POST', body: form, headers });
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
}
