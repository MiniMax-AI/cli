import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Client } from "../client";
import { musicEndpoint } from "../../client/endpoints";
import { MusicRequest, MusicResponse } from "../../types/api";
import { ModelPartial } from "../types";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { toMerged } from "es-toolkit/object";
import { MUSIC_GENERATE_MODELS, musicGenerateModel } from "../../commands/music/models";
import { decodeAudioStream } from "../../utils/audio-stream";

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

export interface MusicGenerateRequest extends MusicRequest {
  /** Vocal style, e.g. "warm male baritone", "bright female soprano", "duet with harmonies" */
  vocals?: string;
  /** Music genre, e.g. folk, pop, jazz */
  genre?: string;
  /** Mood or emotion, e.g. warm, melancholic, uplifting */
  mood?: string;
  /** Instruments to feature, e.g. "acoustic guitar, piano" */
  instruments?: string;
  /** Tempo description, e.g. fast, slow, moderate */
  tempo?: string;
  /** Exact tempo in beats per minute */
  bpm?: number;
  /** Musical key, e.g. C major, A minor, G sharp */
  key?: string;
  /** Elements to avoid in the generated music */
  avoid?: string;
  /** Use case context, e.g. "background music for video", "theme song" */
  use_case?: string;
  /** Song structure, e.g. "verse-chorus-verse-bridge-chorus" */
  structure?: string;
  /** Reference tracks or artists, e.g. "similar to Ed Sheeran, Taylor Swift" */
  references?: string;
  /** Additional fine-grained requirements not covered above */
  extra?: string;
  /** Generate instrumental music (no vocals) */
  instrumental?: boolean;
  /** Use case */
  useCase?: string;
}

export class MusicSDK extends Client {
  private async *generateStream(body: ModelPartial<MusicGenerateRequest>, url: string): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    const res = await this.request({
      url,
      method: 'POST',
      body,
      stream: true,
    });

    if (!res.body) {
      throw new SDKError('No response body', ExitCode.GENERAL);
    }

    yield* decodeAudioStream(res);
  }

  async generate(request: ModelPartial<MusicGenerateRequest> & { stream: true }): Promise<AsyncGenerator<Uint8Array<ArrayBuffer>>>;
  async generate(request: ModelPartial<MusicGenerateRequest>): Promise<MusicResponse>;
  async generate(request: ModelPartial<MusicGenerateRequest>): Promise<MusicResponse | AsyncGenerator<Uint8Array<ArrayBuffer>>> {
    const body = this.validateParams(request);

    const url = musicEndpoint(this.config.baseUrl);

    if (request.stream) {
      return this.generateStream(body, url);
    }

    return await this.requestJson<MusicResponse>({
      url,
      method: 'POST',
      body,
    });
  }

  /**
   * Save generated music audio to a file. Decodes the hex-encoded audio
   * from the API response and writes it to disk. Creates intermediate
   * directories as needed.
   *
   * @param response — The response from `generate()`.
   * @param outPath  — Target file path. Defaults to `music_<timestamp>.mp3`.
   * @param ext      — File extension (default: `"mp3"`).
   * @returns The absolute path of the saved file.
   */
  save(response: MusicResponse, outPath?: string, ext = 'mp3'): string {
    const dest = resolve(outPath || defaultFilename('music', ext));
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

  private buildPrompt(request: ModelPartial<MusicGenerateRequest>) {
    const structuredParts: string[] = [];
    if (request.vocals)      structuredParts.push(`Vocals: ${request.vocals as string}`);
    if (request.genre)       structuredParts.push(`Genre: ${request.genre as string}`);
    if (request.mood)        structuredParts.push(`Mood: ${request.mood as string}`);
    if (request.instruments) structuredParts.push(`Instruments: ${request.instruments as string}`);
    if (request.tempo)       structuredParts.push(`Tempo: ${request.tempo as string}`);
    if (request.bpm)         structuredParts.push(`BPM: ${request.bpm as number}`);
    if (request.key)         structuredParts.push(`Key: ${request.key as string}`);
    if (request.avoid)       structuredParts.push(`Avoid: ${request.avoid as string}`);
    const useCase = request.useCase || request.use_case;
    if (useCase)             structuredParts.push(`Use case: ${useCase}`);
    if (request.structure)   structuredParts.push(`Structure: ${request.structure as string}`);
    if (request.references)  structuredParts.push(`References: ${request.references as string}`);
    if (request.extra)       structuredParts.push(`Extra: ${request.extra as string}`);

    let prompt = request.prompt;

    if (request.is_instrumental || request.instrumental) {
      structuredParts.push('Style: instrumental, no vocals, pure music');
    }

    if (structuredParts.length > 0) {
      const structured = structuredParts.join('. ');
      prompt = prompt ? `${prompt}. ${structured}` : structured;
    }
    return prompt;
  }

  private validateParams(params: ModelPartial<MusicGenerateRequest>) {
    const instrumental = params.instrumental;
    const apiParams = { ...params };
    const sdkOnlyFields: Array<keyof MusicGenerateRequest> = [
      'instrumental',
      'vocals',
      'genre',
      'mood',
      'instruments',
      'tempo',
      'bpm',
      'key',
      'avoid',
      'use_case',
      'useCase',
      'structure',
      'references',
      'extra',
    ];
    for (const field of sdkOnlyFields) delete apiParams[field];
    if (
      instrumental !== undefined
      && params.is_instrumental !== undefined
      && instrumental !== params.is_instrumental
    ) {
      throw new SDKError(
        'instrumental and is_instrumental must not conflict',
        ExitCode.USAGE,
      );
    }

    const normalized: ModelPartial<MusicGenerateRequest> = {
      ...apiParams,
      is_instrumental: params.is_instrumental ?? instrumental,
    };
    const {
      model, output_format, stream, prompt, lyrics, is_instrumental, lyrics_optimizer,
    } = normalized;
    if (is_instrumental && lyrics) {
      throw new SDKError('Cannot use is_instrumental with lyrics', ExitCode.USAGE);
    }

    if (lyrics_optimizer && (lyrics || is_instrumental)) {
      throw new SDKError('Cannot use lyrics_optimizer with lyrics or is_instrumental', ExitCode.USAGE);
    }

    if (!prompt && !lyrics && !is_instrumental && !lyrics_optimizer) {
      throw new SDKError('At least one of prompt or lyrics or is_instrumental or lyrics_optimizer is required', ExitCode.USAGE);
    }

    if ((is_instrumental || lyrics_optimizer) && !prompt?.trim()) {
      throw new SDKError(
        'prompt is required with is_instrumental or lyrics_optimizer',
        ExitCode.USAGE,
      );
    }

    if (!is_instrumental && !lyrics_optimizer && !lyrics?.trim()) {
      throw new SDKError('lyrics is required', ExitCode.USAGE);
    }

    if (model && !MUSIC_GENERATE_MODELS.includes(model as typeof MUSIC_GENERATE_MODELS[number])) {
      throw new SDKError(
        `Invalid model: ${model}. Valid models are ${MUSIC_GENERATE_MODELS.join(', ')}.`,
        ExitCode.USAGE,
      );
    }

    const VALID_OUTPUT_FORMATS = ['hex', 'url'];
    if (output_format && !VALID_OUTPUT_FORMATS.includes(output_format)) {
      throw new SDKError(
        `Invalid output format: ${output_format}. Valid formats are ${VALID_OUTPUT_FORMATS.join(', ')}.`, 
        ExitCode.USAGE,
      );
    }
    if (stream && output_format === 'url') {
      throw new SDKError(
        `stream and output_format url cannot be used together. Streaming requires hex format.`, 
        ExitCode.USAGE,
      );
    }

    const targetPrompt = this.buildPrompt({
      ...params,
      is_instrumental,
    });

    return toMerged({
      model: musicGenerateModel(this.config),
      audio_setting: {
        format: 'mp3',
        sample_rate: 44100,
        bitrate: 256000,
      },
      output_format: 'hex',
    }, {
      ...normalized,
      prompt: targetPrompt,
    });
  }
}
