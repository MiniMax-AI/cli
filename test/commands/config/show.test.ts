import { describe, it, expect, spyOn } from 'bun:test';
import { default as showCommand } from '../../../src/commands/config/show';
import * as configLoader from '../../../src/config/loader';

const CONFIG_FILE = {
  api_key: 'sk-cp-test-key',
  default_text_model: 'MiniMax-M3',
  default_speech_model: 'speech-2.8-hd',
  default_video_model: 'MiniMax-Hailuo-2.3-6s-768p',
  default_music_model: 'music-3.0',
};

describe('config show command', () => {
  it('has correct name', () => {
    expect(showCommand.name).toBe('config show');
  });

  it('shows configuration', async () => {
    const readConfigFile = spyOn(configLoader, 'readConfigFile').mockReturnValue(CONFIG_FILE);
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 300,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.base_url).toBe('https://api.mmx.io');
      expect(parsed.timeout).toBe(300);
    } finally {
      console.log = originalLog;
      readConfigFile.mockRestore();
    }
  });

  it('includes default models in output', async () => {
    const readConfigFile = spyOn(configLoader, 'readConfigFile').mockReturnValue(CONFIG_FILE);
    const config = {
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 300,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.default_text_model).toBe('MiniMax-M3');
      expect(parsed.default_speech_model).toBe('speech-2.8-hd');
      expect(parsed.default_video_model).toBe('MiniMax-Hailuo-2.3-6s-768p');
      expect(parsed.default_music_model).toBe('music-3.0');
    } finally {
      console.log = originalLog;
      readConfigFile.mockRestore();
    }
  });
});
