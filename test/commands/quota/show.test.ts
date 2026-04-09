import { describe, it, expect, afterEach, vi } from 'bun:test';

// Store mock fn reference so we can configure it before the module imports it
const mockRequestJson = vi.fn();

vi.mock('../../../src/client/http', () => ({
  requestJson: mockRequestJson,
}));

// Pre-configure mock: API returns usage_count fields holding REMAINING values (the bug)
mockRequestJson.mockResolvedValue({
  model_remains: [
    {
      model_name: 'MiniMax-M*',
      start_time: 1775750400000,
      end_time: 1775768400000,
      remains_time: 1464894,
      current_interval_total_count: 1500,
      current_interval_usage_count: 1417, // ← API says "usage" but value = remaining (the bug)
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      weekly_start_time: 1775404800000,
      weekly_end_time: 1776009600000,
      weekly_remains_time: 242664894,
    },
    {
      model_name: 'speech-hd',
      start_time: 1775750400000,
      end_time: 1775836800000,
      remains_time: 69864894,
      current_interval_total_count: 4000,
      current_interval_usage_count: 4000, // exhausted → remaining = 0
      current_weekly_total_count: 28000,
      current_weekly_usage_count: 28000,
      weekly_start_time: 1775404800000,
      weekly_end_time: 1776009600000,
      weekly_remains_time: 242664894,
    },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
});

import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';

const baseConfig: Config = {
  apiKey: 'test-key',
  region: 'global' as const,
  baseUrl: 'https://api.minimax.io',
  output: 'text' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: false,
  nonInteractive: true,
  async: false,
};

const baseFlags: GlobalFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('quota show command', () => {
  afterEach(() => {
    mockRequestJson.mockClear();
  });

  it('has correct name', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');
    expect(showCommand.name).toBe('quota show');
  });

  it('handles dry run without calling API', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute({ ...baseConfig, dryRun: true }, baseFlags);
      expect(output).toContain('Would fetch quota');
      expect(mockRequestJson).not.toHaveBeenCalled();
    } finally {
      console.log = originalLog;
    }
  });

  it('--output json: fixes current_interval_usage_count to be actual usage (no new fields)', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');

    const config = { ...baseConfig, output: 'json' as const };
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, { ...baseFlags, output: 'json' });
      const parsed = JSON.parse(output);

      const m = parsed.model_remains[0];
      // After fix: usage_count = total - remaining = 1500 - 1417 = 83 (actual usage)
      expect(m.current_interval_usage_count).toBe(83);
      expect(m.current_interval_total_count).toBe(1500);
      // No new fields added — schema unchanged
      expect(m.current_interval_remaining_count).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });

  it('--output json: fixes current_weekly_usage_count to be actual usage for exhausted model', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');

    const config = { ...baseConfig, output: 'json' as const };
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, { ...baseFlags, output: 'json' });
      const parsed = JSON.parse(output);

      // speech-hd: weekly_usage_count = weekly_total - remaining = 28000 - 28000 = 0
      const speech = parsed.model_remains.find(
        (m: { model_name: string }) => m.model_name === 'speech-hd',
      );
      expect(speech.current_weekly_usage_count).toBe(0);
      expect(speech.current_weekly_total_count).toBe(28000);
    } finally {
      console.log = originalLog;
    }
  });

  it('--quiet: tab line contains correct values (usage=83, total=1500, remaining=1417)', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');

    const config = { ...baseConfig, quiet: true };
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      // flags.output must be 'text' (not auto-detected) to reach quiet branch
      await showCommand.execute(config, { ...baseFlags, output: 'text' });
      const trimmed = output.trim();

      // After fix: usage_count=83 (actual usage), remaining=1417
      expect(trimmed).toContain('MiniMax-M*');
      expect(trimmed).toContain('\t83\t');    // used = 1500-1417 = 83
      expect(trimmed).toContain('\t1500\t');  // total
      expect(trimmed).toContain('1417');        // remaining
    } finally {
      console.log = originalLog;
    }
  });

  it('--quiet: exhausted quota shows usage=0 (total - remaining = 4000-4000)', async () => {
    const { default: showCommand } = await import('../../../src/commands/quota/show');

    const config = { ...baseConfig, quiet: true };
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, { ...baseFlags, output: 'text' });
      const trimmed = output.trim();

      // speech-hd: total=4000, remaining=4000 → usage=0
      expect(trimmed).toContain('speech-hd');
      expect(trimmed).toContain('\t0\t');      // usage = 0
      expect(trimmed).toContain('\t4000\t');    // total
    } finally {
      console.log = originalLog;
    }
  });
});
