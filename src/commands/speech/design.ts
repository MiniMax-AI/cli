import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { voiceDesignEndpoint } from '../../client/endpoints';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { detectOutputFormat, dryRun, formatOutput } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VoiceDesignRequest, VoiceResponse } from '../../types/api';

export default defineCommand({
  name: 'speech design',
  description: 'Design a voice from a prompt',
  apiDocs: '/docs/api-reference/voice-design-design',
  usage: 'mmx speech design --prompt <text> --voice-id <id>',
  options: [
    { flag: '--prompt <text>', description: 'Voice design prompt', required: true },
    { flag: '--voice-id <id>', description: 'Voice ID to create', required: true },
  ],
  examples: [
    'mmx file upload --file prompt.wav --purpose prompt_audio',
    'mmx speech design --prompt "Warm and clear narrator" --voice-id narrator_voice',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const prompt = flags.prompt as string | undefined;
    const voiceId = flags.voiceId as string | undefined;

    if (!prompt) {
      throw new CLIError('--prompt is required.', ExitCode.USAGE, 'mmx speech design --prompt <text> --voice-id <id>');
    }
    if (!voiceId) {
      throw new CLIError('--voice-id is required.', ExitCode.USAGE, 'mmx speech design --prompt <text> --voice-id <id>');
    }

    const body: VoiceDesignRequest = {
      prompt,
      voice_id: voiceId,
    };

    if (dryRun(config, body)) return;

    const response = await requestJson<VoiceResponse>(config, {
      url: voiceDesignEndpoint(config.baseUrl),
      method: 'POST',
      body,
    });

    if (config.quiet) {
      process.stdout.write(response.voice_id + '\n');
      return;
    }

    process.stdout.write(formatOutput(response, detectOutputFormat(config.output)) + '\n');
  },
});
