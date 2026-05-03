import { Client } from "../client";
import { speechEndpoint, voicesEndpoint } from "../../client/endpoints";
import { SpeechRequest, SpeechResponse, VoiceListResponse } from "../../types/api";
import { parseSSE } from "../../client/stream";
import { filterByLanguage } from "../../commands/speech/voices";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from "es-toolkit/object";
import { ModelPartial } from "../types";

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

    for await (const event of parseSSE(res)) {
      if (!event.data || event.data === '[DONE]') break;
      try {
        const parsed = JSON.parse(event.data) as SpeechResponse;
        yield parsed;
      } catch (err) {
        throw new SDKError(
          `Failed to parse stream chunk: ${err instanceof Error ? err.message : String(err)}`,
          ExitCode.GENERAL,
        );
      }
    }
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
