import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { voiceDesignEndpoint } from '../../client/endpoints';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { detectOutputFormat, dryRun, formatOutput } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VoiceDesignRequest, VoiceDesignResponse } from '../../types/api';

export default defineCommand({
  name: 'speech design',
  description: 'Design a voice from a prompt',
  apiDocs: '/docs/api-reference/voice-design-design',
  usage: 'mmx speech design --prompt <text> --preview-text <text> [--voice-id <id>]',
  options: [
    { flag: '--prompt <text>', description: 'Voice design prompt', required: true },
    { flag: '--preview-text <text>', description: 'Text for the generated voice preview', required: true },
    { flag: '--voice-id <id>', description: 'Optional voice ID to create' },
  ],
  examples: [
    'mmx file upload --file prompt.wav --purpose prompt_audio',
    'mmx speech design --prompt "Warm and clear narrator" --preview-text "Welcome to the show"',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const prompt = flags.prompt as string | undefined;
    const previewText = flags.previewText as string | undefined;
    const voiceId = flags.voiceId as string | undefined;

    if (!prompt) {
      throw new CLIError('--prompt is required.', ExitCode.USAGE, 'mmx speech design --prompt <text> --voice-id <id>');
    }
    if (!previewText) {
      throw new CLIError('--preview-text is required.', ExitCode.USAGE, 'mmx speech design --prompt <text> --preview-text <text>');
    }

    const body: VoiceDesignRequest = {
      prompt,
      preview_text: previewText,
      ...(voiceId ? { voice_id: voiceId } : {}),
    };

    if (dryRun(config, body)) return;

    const response = await requestJson<VoiceDesignResponse>(config, {
      url: voiceDesignEndpoint(config.baseUrl),
      method: 'POST',
      body,
    });

    if (config.quiet) {
      process.stdout.write((response.voice_id || '') + '\n');
      return;
    }

    process.stdout.write(formatOutput(response, detectOutputFormat(config.output)) + '\n');
  },
});
