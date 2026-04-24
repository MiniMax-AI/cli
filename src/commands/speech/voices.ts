import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { voicesEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VoiceListResponse, SystemVoiceInfo } from '../../types/api';

function extractLanguage(voiceId: string): string {
  // voice_id format: "Language_VoiceName" or "Language (Dialect)_VoiceName"
  // Match up to the last underscore-separated word that starts with uppercase
  const match = voiceId.match(/^(.+?)_[A-Z]/);
  return match ? match[1] : voiceId;
}

function filterByLanguage(voices: SystemVoiceInfo[], language: string): SystemVoiceInfo[] {
  const lang = language.toLowerCase();
  return voices.filter(v => {
    const voiceLang = extractLanguage(v.voice_id).toLowerCase();
    // Exact prefix match: "english" matches "English_*" but not "Korean_*"
    return voiceLang === lang || voiceLang.startsWith(lang + '_') || voiceLang.startsWith(lang + ' (');
  });
}

export default defineCommand({
  name: 'speech voices',
  description: 'List available system voices',
  usage: 'mmx speech voices [--language <lang>]',
  options: [
    { flag: '--language <lang>', description: 'Filter voices by language (e.g. english, korean, japanese)' },
  ],
  examples: [
    'mmx speech voices',
    'mmx speech voices --language english',
    'mmx speech voices --language korean',
    'mmx speech voices --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      console.log(formatOutput({ request: { voice_type: 'system' } }, format));
      return;
    }

    const response = await requestJson<VoiceListResponse>(config, {
      url: voicesEndpoint(config.baseUrl),
      method: 'POST',
      body: { voice_type: 'system' },
    });

    const voices = response.system_voice ?? [];
    const language = flags.language as string | undefined;

    if (language) {
      const filtered = filterByLanguage(voices, language);

      if (format !== 'text') {
        console.log(formatOutput(filtered, format));
        return;
      }

      for (const v of filtered) {
        const desc = v.description?.join('; ') || '';
        const name = v.voice_name ? ` (${v.voice_name})` : '';
        console.log(`  ${v.voice_id}${name}`);
        if (desc) console.log(`    ${desc}`);
      }
    } else {
      if (format !== 'text') {
        console.log(formatOutput(voices.map(v => v.voice_id), format));
        return;
      }

      for (const v of voices) {
        console.log(v.voice_id);
      }
    }
  },
});
