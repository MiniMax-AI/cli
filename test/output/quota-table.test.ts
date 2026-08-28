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
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      current_weekly_remaining_percent: 98,
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

  it('uses remaining percent to disambiguate newer used-count responses', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            model_name: 'video',
            current_interval_total_count: 5,
            current_interval_usage_count: 0,
            current_interval_remaining_percent: 100,
            current_weekly_total_count: 35,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('5 / 5');
    expect(output).toContain('35 / 35');
    expect(output).not.toContain('0 / 5');
    expect(output).not.toContain('0 / 35');
  });

  it('falls back to the authoritative percent when counts cannot be reconciled', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            current_interval_total_count: 10,
            current_interval_usage_count: 7,
            current_interval_remaining_percent: 40,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('Left [████......]  40%');
    expect(output).not.toContain('7 / 10');
    expect(output).not.toContain('3 / 10');
  });

  it('renders the reset countdown in a boxed column with the window duration tag', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(createCodingPlanModels(), { ...createConfig(), noColor: true });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');

    // general: 2-hour rolling window; video: daily window.
    expect(output).toContain('| 2h Reset 2h 0m |');
    expect(output).toContain('| 1d Reset 6h 0m |');
    // Every data row carries the column divider before the reset cell.
    const dataRows = lines.filter(l => l.includes('Reset'));
    expect(dataRows.length).toBe(2);
    for (const row of dataRows) {
      expect(row.split('|').length).toBe(4);
    }
  });

  it('applies weekly_boost_permille (1500 ⇒ up to 150%) when rendering weekly percent', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
            weekly_boost_permille: 1500,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('Wk left [██████████] 150%');
  });

  it('clamps boosted weekly percent at MAX_DISPLAY_PCT (200)', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
            weekly_boost_permille: 3000,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('200%');
    expect(output).not.toContain('300%');
  });

  it('renders "无限" for weekly when status=3 (CN region)', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
            current_weekly_status: 3,
            weekly_boost_permille: 1500,
          },
        ],
        { ...createConfig(), region: 'cn', noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('[██████████]');
    expect(output).toContain('周剩余');
    expect(output).toContain('无限');
    expect(output).not.toContain('150%');
  });

  it('renders "unlimited" for weekly when status=3 (global region)', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
            current_weekly_status: 3,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('[██████████]');
    expect(output).toContain('Wk left');
    expect(output).toContain('unlimited');
    expect(output).not.toContain('100%');
  });

  it('renders a zero-allocation model as unavailable instead of unlimited', () => {
    const lines: string[] = [];
    const originalLog = console.log;

    console.log = (message?: unknown) => {
      lines.push(String(message ?? ''));
    };

    try {
      renderQuotaTable(
        [
          {
            ...createModel(),
            model_name: 'video',
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            current_interval_remaining_percent: 100,
            current_interval_status: 3,
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 100,
            current_weekly_status: 3,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('not in plan');
    expect(output).toContain('Reset —');
    expect(output).not.toContain('unlimited');
    expect(output).not.toContain('100%');
  });
});
