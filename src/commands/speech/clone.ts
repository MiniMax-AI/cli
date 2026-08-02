import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { fileUploadEndpoint, voiceCloneEndpoint } from '../../client/endpoints';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { detectOutputFormat, formatOutput } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { FileUploadResponse, VoiceCloneRequest, VoiceResponse } from '../../types/api';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';

const DEFAULT_VOICE_CLONE_MODEL = 'speech-2.8-hd';

async function uploadCloneAudio(config: Config, filePath: string): Promise<FileUploadResponse> {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    throw new CLIError(`File not found: ${fullPath}`, ExitCode.USAGE);
  }

  const formData = new FormData();
  formData.append('file', new Blob([await readFile(fullPath)]), basename(fullPath));
  formData.append('purpose', 'voice_clone');

  return requestJson<FileUploadResponse>(config, {
    url: fileUploadEndpoint(config.baseUrl),
    method: 'POST',
    body: formData,
  });
}

export default defineCommand({
  name: 'speech clone',
  description: 'Clone a voice from uploaded audio',
  apiDocs: '/docs/api-reference/voice-cloning-clone',
  usage: 'mmx speech clone --file-id <id> --voice-id <id> [--model <model>]',
  options: [
    { flag: '--file-id <id>', description: 'Uploaded clone audio file ID' },
    { flag: '--file <path>', description: 'Upload local clone audio before cloning' },
    { flag: '--voice-id <id>', description: 'Voice ID to create', required: true },
    { flag: '--model <model>', description: 'Clone model (default: speech-2.8-hd)' },
  ],
  examples: [
    'mmx file upload --file sample.wav --purpose voice_clone',
    'mmx speech clone --file-id 123 --voice-id my_voice',
    'mmx speech clone --file sample.wav --voice-id my_voice --model speech-2.6-hd',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const voiceId = flags.voiceId as string | undefined;
    const filePath = flags.file as string | undefined;
    let fileId = flags.fileId as string | undefined;

    if (!voiceId) {
      throw new CLIError('--voice-id is required.', ExitCode.USAGE, 'mmx speech clone --file-id <id> --voice-id <id>');
    }
    if (!fileId && !filePath) {
      throw new CLIError('--file-id or --file is required.', ExitCode.USAGE, 'mmx speech clone --file-id <id> --voice-id <id>');
    }

    const model = (flags.model as string) || DEFAULT_VOICE_CLONE_MODEL;
    const body: VoiceCloneRequest = {
      file_id: fileId || '<uploaded-file-id>',
      voice_id: voiceId,
      model,
    };
    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      const request = filePath
        ? { upload: { file: resolve(filePath), purpose: 'voice_clone' }, clone: body }
        : body;
      process.stdout.write(formatOutput({ request }, format) + '\n');
      return;
    }

    if (!fileId && filePath) {
      const upload = await uploadCloneAudio(config, filePath);
      fileId = upload.file.file_id;
      body.file_id = fileId;
    }

    const response = await requestJson<VoiceResponse>(config, {
      url: voiceCloneEndpoint(config.baseUrl),
      method: 'POST',
      body,
    });

    if (config.quiet) {
      process.stdout.write(response.voice_id + '\n');
      return;
    }

    process.stdout.write(formatOutput(response, format) + '\n');
  },
});
