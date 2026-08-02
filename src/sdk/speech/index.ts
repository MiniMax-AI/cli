import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { Client } from "../client";
import { fileUploadEndpoint, speechEndpoint, voiceCloneEndpoint, voiceDesignEndpoint, voicesEndpoint } from "../../client/endpoints";
import { FileUploadResponse, SpeechRequest, SpeechResponse, VoiceCloneRequest, VoiceDesignRequest, VoiceListResponse, VoiceResponse } from "../../types/api";
import { filterByLanguage } from "../../commands/speech/voices";
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

  async uploadCloneAudio(filePath: string): Promise<FileUploadResponse> {
    return this.uploadVoiceAudio(filePath, 'voice_clone');
  }

  async uploadPromptAudio(filePath: string): Promise<FileUploadResponse> {
    return this.uploadVoiceAudio(filePath, 'prompt_audio');
  }

  async clone(request: VoiceCloneRequest): Promise<VoiceResponse> {
    if (!request.file_id) {
      throw new SDKError('file_id is required', ExitCode.USAGE);
    }
    if (!request.voice_id) {
      throw new SDKError('voice_id is required', ExitCode.USAGE);
    }
    if (!request.model) {
      throw new SDKError('model is required', ExitCode.USAGE);
    }

    return this.requestJson<VoiceResponse>({
      url: voiceCloneEndpoint(this.config.baseUrl),
      method: 'POST',
      body: request,
    });
  }

  async design(request: VoiceDesignRequest): Promise<VoiceResponse> {
    if (!request.prompt) {
      throw new SDKError('prompt is required', ExitCode.USAGE);
    }
    if (!request.voice_id) {
      throw new SDKError('voice_id is required', ExitCode.USAGE);
    }

    return this.requestJson<VoiceResponse>({
      url: voiceDesignEndpoint(this.config.baseUrl),
      method: 'POST',
      body: request,
    });
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

  private async uploadVoiceAudio(filePath: string, purpose: 'voice_clone' | 'prompt_audio'): Promise<FileUploadResponse> {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) {
      throw new SDKError(`File not found: ${fullPath}`, ExitCode.USAGE);
    }

    const fileData = await readFile(fullPath);
    const formData = new FormData();
    formData.append('file', new Blob([fileData]), basename(fullPath));
    formData.append('purpose', purpose);

    return this.requestJson<FileUploadResponse>({
      url: fileUploadEndpoint(this.config.baseUrl),
      method: 'POST',
      body: formData,
    });
  }
}
