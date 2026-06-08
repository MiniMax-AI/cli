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

function createCodingPlanModels(): QuotaModelRemain[] {
  return [
    {
      model_name: 'general',
      start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      end_time: Date.UTC(2026, 4, 31, 2, 0, 0),
      remains_time: 2 * 60 * 60 * 1000,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      current_interval_remaining_percent: 94,
      current_interval_status: 1,
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      current_weekly_remaining_percent: 98,
      current_weekly_status: 1,
      interval_boost_permille: 2000,
      weekly_boost_permille: 2000,
      weekly_start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      weekly_end_time: Date.UTC(2026, 5, 7, 0, 0, 0),
      weekly_remains_time: 6 * 24 * 60 * 60 * 1000,
    },
    {
      model_name: 'video',
      start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      end_time: Date.UTC(2026, 5, 1, 0, 0, 0),
      remains_time: 6 * 60 * 60 * 1000,
      current_interval_total_count: 3,
      current_interval_usage_count: 3,
      current_interval_remaining_percent: 100,
      current_weekly_total_count: 21,
      current_weekly_usage_count: 21,
      current_weekly_remaining_percent: 100,
      weekly_start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      weekly_end_time: Date.UTC(2026, 5, 7, 0, 0, 0),
      weekly_remains_time: 6 * 24 * 60 * 60 * 1000,
    },
  ];
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

  it('renders coding plan remaining quotas without deriving counts from percent', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(createCodingPlanModels(), {
        ...createConfig(),
        region: 'cn',
        noColor: true,
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');

    expect(output).toContain('通用');
    expect(output).toContain('剩余 [█████████.]  94%');
    expect(output).toContain('周剩余 [██████████]  98%');
    expect(output).toContain('视频');
    expect(output).toContain('3 / 3');
    expect(output).toContain('21 / 21');
    expect(output).not.toContain('0 / 3');
  });

  it('renders boost multiplier when boost_permille > 1000', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(createCodingPlanModels(), {
        ...createConfig(),
        region: 'cn',
        noColor: true,
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');

    // general model has interval_boost_permille=2000 => ×2 prefix
    expect(output).toContain('通用 ×2');
    // video model has no boost field => no ×2 on its row
    // ensure the video line is still present (so the negative check is meaningful)
    expect(output).toContain('视频');
  });

  it('omits boost multiplier when boost_permille is missing', () => {
    const modelsNoBoost: QuotaModelRemain[] = [{
      model_name: 'general',
      start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      end_time: Date.UTC(2026, 4, 31, 2, 0, 0),
      remains_time: 2 * 60 * 60 * 1000,
      current_interval_total_count: 100,
      current_interval_usage_count: 50,
      current_interval_remaining_percent: 50,
      current_weekly_total_count: 1000,
      current_weekly_usage_count: 200,
      current_weekly_remaining_percent: 80,
      weekly_start_time: Date.UTC(2026, 4, 31, 0, 0, 0),
      weekly_end_time: Date.UTC(2026, 5, 7, 0, 0, 0),
      weekly_remains_time: 6 * 24 * 60 * 60 * 1000,
    }];

    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(modelsNoBoost, {
        ...createConfig(),
        region: 'cn',
        noColor: true,
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');

    expect(output).toContain('通用');
    expect(output).not.toContain('×2');
  });

  it('renders "not in plan" for status=3 rows instead of a misleading 100%', () => {
    // issue #173: a plan without video. The server marks the unavailable row
    // status=3 (counts 0/0, percent 100); the in-plan general row stays status=1.
    const base = createCodingPlanModels();
    const models: QuotaModelRemain[] = [
      { ...base[0]!, current_interval_status: 1, current_weekly_status: 1 },
      { ...base[1]!, current_interval_status: 3, current_weekly_status: 3 },
    ];

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };
    try {
      renderQuotaTable(models, { ...createConfig(), region: 'cn', noColor: true });
    } finally {
      console.log = originalLog;
    }

    // video (status=3) says "not in plan"; its percent/bar must not leak through
    const videoLine = lines.find((l) => l.includes('视频')) ?? '';
    expect(videoLine).toContain('不在当前套餐中');
    expect(videoLine).not.toContain('100%');
    expect(videoLine).not.toContain('[');
    // the in-plan general row (status=1) still renders its bar
    const generalLine = lines.find((l) => l.includes('通用')) ?? '';
    expect(generalLine).not.toContain('不在当前套餐中');
    expect(generalLine).toContain('[');
  });
});
