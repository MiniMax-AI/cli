import { describe, it, expect } from 'bun:test';
import {
  renderQuotaTable,
  isNotInPlan,
  isUnweekly,
} from '../../src/output/quota-table';
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

  // Behavior change for #173: when status=3 but total_count=0, the API is
  // signalling "not in your plan" (a 0/0 bucket), not "unlimited". The CLI
  // must surface this so users do not see "100% remaining" for a model
  // they cannot actually use.
  it('renders "不在套餐中" for weekly when status=3 + total_count=0 (CN region)', () => {
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
    expect(output).toContain('周剩余');
    expect(output).toContain('不在套餐中');
    expect(output).not.toContain('无限');
    expect(output).not.toContain('150%');
  });

  it('renders "not in plan" for weekly when status=3 + total_count=0 (global region)', () => {
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
    expect(output).toContain('Wk left');
    expect(output).toContain('not in plan');
    expect(output).not.toContain('unlimited');
    expect(output).not.toContain('100%');
  });

  it('still renders "unlimited" when status=3 + total_count > 0 (genuine unlimited)', () => {
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
            current_weekly_total_count: 5000,
            current_weekly_usage_count: 100,
            current_weekly_remaining_percent: 98,
            current_weekly_status: 3,
          },
        ],
        { ...createConfig(), noColor: true },
      );
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('Wk left');
    expect(output).toContain('unlimited');
    expect(output).not.toContain('not in plan');
  });

  it('renders "not in plan" for interval (current) row when status=3 + total_count=0', () => {
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
    expect(output).toContain('Left');
    expect(output).toContain('not in plan');
    // The bug: previously this rendered "100%" via current_interval_remaining_percent.
    expect(output).not.toContain('100%');
  });
});

describe('isNotInPlan', () => {
  it('returns true when total_count is 0 and status is 3', () => {
    expect(isNotInPlan(0, 3)).toBe(true);
  });

  it('returns false when total_count is positive (real unlimited)', () => {
    expect(isNotInPlan(100, 3)).toBe(false);
  });

  it('returns false when status is not 3 (plain zero quota)', () => {
    expect(isNotInPlan(0, 1)).toBe(false);
    expect(isNotInPlan(0, 2)).toBe(false);
  });

  it('returns false when status is undefined or null', () => {
    expect(isNotInPlan(0, undefined)).toBe(false);
    expect(isNotInPlan(0, null)).toBe(false);
  });
});

describe('isUnweekly', () => {
  it('returns true only when status is 3 and total_count is positive', () => {
    expect(isUnweekly(3, 100)).toBe(true);
  });

  it('returns false when total_count is 0 (would be not-in-plan)', () => {
    expect(isUnweekly(3, 0)).toBe(false);
  });

  it('returns false when status is not 3', () => {
    expect(isUnweekly(1, 100)).toBe(false);
    expect(isUnweekly(2, 100)).toBe(false);
  });

  it('returns false when status is undefined or null', () => {
    expect(isUnweekly(undefined, 100)).toBe(false);
    expect(isUnweekly(null, 100)).toBe(false);
  });
});
