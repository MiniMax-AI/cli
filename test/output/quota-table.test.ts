import { describe, it, expect } from 'bun:test';
import { renderQuotaTable } from '../../src/output/quota-table';
import type { Config } from '../../src/config/schema';
import type { QuotaModelRemain } from '../../src/types/api';

const WHITE_ANSI = '\x1b[38;2;255;255;255m';

function createConfig(): Config {
  return {
    region: 'global',
    baseUrl: 'https://api.minimax.io',
    output: 'text',
    timeout: 10_000,
    verbose: false,
    quiet: false,
    noColor: false,
    yes: false,
    dryRun: false,
    nonInteractive: true,
    async: false,
  };
}

function createModel(): QuotaModelRemain {
  return {
    model_name: 'MiniMax-M2',
    start_time: Date.UTC(2026, 3, 18, 0, 0, 0),
    end_time: Date.UTC(2026, 3, 18, 12, 0, 0),
    remains_time: 3 * 60 * 60 * 1000,
    current_interval_total_count: 1500,
    current_interval_usage_count: 80,
    current_weekly_total_count: 15000,
    current_weekly_usage_count: 666,
    weekly_start_time: Date.UTC(2026, 3, 12, 0, 0, 0),
    weekly_end_time: Date.UTC(2026, 3, 19, 0, 0, 0),
    weekly_remains_time: 3 * 60 * 60 * 1000,
  };
}

describe('renderQuotaTable', () => {
  it('does not force model names to white in color mode', () => {
    const lines: string[] = [];
    const originalLog = console.log;
    const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    try {
      renderQuotaTable([createModel()], createConfig());
    } finally {
      console.log = originalLog;
      if (ttyDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
      }
    }

    const output = lines.join('\n');

    expect(output).toContain('MiniMax-M2');
    expect(output).not.toContain(WHITE_ANSI);
  });
});
