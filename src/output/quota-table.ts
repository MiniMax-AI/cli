import type { Config } from '../config/schema';
import type { QuotaModelRemain } from '../types/api';

// ── ANSI color constants ──

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const MM_BLUE = '\x1b[38;2;43;82;255m';
const MM_CYAN = '\x1b[38;2;6;184;212m';
const FG_GREEN = '\x1b[38;2;74;222;128m';
const FG_YELLOW = '\x1b[38;2;250;204;21m';
const FG_RED = '\x1b[38;2;248;113;113m';
const BG_GREEN = '\x1b[48;2;22;163;74m';
const BG_YELLOW = '\x1b[48;2;202;138;4m';
const BG_RED = '\x1b[48;2;220;38;38m';
const BG_EMPTY = '\x1b[48;2;55;65;81m';

function remainingColors(remainingPct: number): [string, string] {
  if (remainingPct >= 50) return [FG_GREEN, BG_GREEN];
  if (remainingPct >= 20) return [FG_YELLOW, BG_YELLOW];
  return [FG_RED, BG_RED];
}

interface Labels {
  dashboard: string;
  week: string;
  current: string;
  weekly: string;
  resetsIn: string;
  noData: string;
  now: string;
  notInPlan: string;
}

const LABELS_EN: Labels = { dashboard: 'TokenPlan Quota', week: 'Week', current: 'Left', weekly: 'Wk left', resetsIn: 'Reset', noData: 'No quota data available.', now: 'now', notInPlan: 'not in plan' };
const LABELS_CN: Labels = { dashboard: 'TokenPlan 配额面板', week: '周期', current: '剩余', weekly: '周剩余', resetsIn: '重置', noData: '暂无配额数据', now: '即将', notInPlan: '不在当前套餐中' };

const MODEL_NAME_CN: Record<string, string> = {
  'general': '通用',
  'video': '视频',
};

function displayModelName(name: string, region: string): string {
  if (region !== 'cn') return name;
  return MODEL_NAME_CN[name] ?? name;
}

function formatDuration(ms: number, nowLabel: string): string {
  if (ms <= 0) return nowLabel;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function isCJK(code: number): boolean {
  return (code >= 0x2E80 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF01 && code <= 0xFF60) ||
    (code >= 0x20000 && code <= 0x2FA1F);
}

function displayWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) w += isCJK(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

const BAR_WIDTH = 16;
const COMPACT_BAR_WIDTH = 10;

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function remainingPct(percent: number | undefined | null, remaining: number, total: number): number {
  return percent !== undefined && percent !== null
    ? clampPct(percent)
    : total > 0 ? clampPct((remaining / total) * 100) : 0;
}

function renderBar(remainingPct: number, color: boolean, barWidth: number = BAR_WIDTH, showPct: boolean = true): string {
  const pct = clampPct(remainingPct);
  const ratio = pct / 100;
  const filled = Math.round(barWidth * ratio);
  const empty = barWidth - filled;
  const pctStr = `${pct}%`.padStart(4);
  if (!color) {
    const bar = `[${'█'.repeat(filled)}${'.'.repeat(empty)}]`;
    return showPct ? `${bar} ${pctStr}` : bar;
  }
  const [fg, bg] = remainingColors(pct);
  const bar = `${bg}${' '.repeat(filled)}${R}${BG_EMPTY}${' '.repeat(empty)}${R}`;
  return showPct ? `${bar} ${fg}${B}${pctStr}${R}` : bar;
}

// Server status for a model not bundled in the plan: counts read 0/0 with
// percent 100, so only status distinguishes it from an in-plan 0/0 row (=1).
const STATUS_NOT_IN_PLAN = 3;

function renderMetric(
  label: string,
  remaining: number,
  total: number,
  percent: number | undefined | null,
  color: boolean,
  status: number | undefined | null,
  notInPlanLabel: string,
): string {
  if (status === STATUS_NOT_IN_PLAN) {
    return color ? `${D}${label}${R} ${FG_RED}${notInPlanLabel}${R}` : `${label} ${notInPlanLabel}`;
  }
  const pct = remainingPct(percent, remaining, total);
  const bar = renderBar(pct, color, COMPACT_BAR_WIDTH, total <= 0);
  if (total > 0) {
    const count = `${remaining.toLocaleString()} / ${total.toLocaleString()}`;
    return color ? `${D}${label}${R} ${bar} ${remainingColors(pct)[0]}${count}${R}` : `${label} ${bar} ${count}`;
  }
  return `${label} ${bar}`;
}

function boxLine(w: number, l: string, f: string, r: string, c: boolean): string {
  return c ? `${D}${l}${f.repeat(w)}${r}${R}` : `+${'-'.repeat(w)}+`;
}

function boxRow(content: string, innerW: number, visLen: number, color: boolean): string {
  const pad = Math.max(0, innerW - 2 - visLen);
  return color ? `${D}│${R} ${content}${' '.repeat(pad)} ${D}│${R}` : `| ${content}${' '.repeat(pad)} |`;
}

export function renderQuotaTable(models: QuotaModelRemain[], config: Config): void {
  const useColor = !config.noColor && process.stdout.isTTY === true;
  const L = config.region === 'cn' ? LABELS_CN : LABELS_EN;

  const rows = models.map((m) => {
    const baseName = displayModelName(m.model_name, config.region);
    const boost = m.interval_boost_permille;
    const boostTag = (boost && boost > 1000) ? ` ×${boost / 1000}` : '';
    const displayName = baseName + boostTag;
    const current = renderMetric(
      L.current,
      m.current_interval_usage_count,
      m.current_interval_total_count,
      m.current_interval_remaining_percent,
      useColor,
      m.current_interval_status,
      L.notInPlan,
    );
    const weekly = renderMetric(
      L.weekly,
      m.current_weekly_usage_count,
      m.current_weekly_total_count,
      m.current_weekly_remaining_percent,
      useColor,
      m.current_weekly_status,
      L.notInPlan,
    );
    const reset = `${L.resetsIn} ${formatDuration(m.remains_time, L.now)}`;
    return { displayName, current, weekly, reset };
  });

  const nameWidth = Math.max(6, ...rows.map(r => displayWidth(r.displayName)));
  const currentWidth = Math.max(...rows.map(r => displayWidth(r.current)), 18);
  const weeklyWidth = Math.max(...rows.map(r => displayWidth(r.weekly)), 18);
  const resetWidth = Math.max(...rows.map(r => displayWidth(r.reset)), 10);
  const W = Math.max(72, nameWidth + 2 + currentWidth + 2 + weeklyWidth + 2 + resetWidth + 4);

  const weekRange = models.length > 0
    ? `${formatDate(models[0]!.weekly_start_time)} — ${formatDate(models[0]!.weekly_end_time)}`
    : '';

  const titlePlain = `MINIMAX  ${L.dashboard}`;
  const weekPlain = `${L.week}: ${weekRange}`;
  const headerGap = Math.max(2, W - 2 - displayWidth(titlePlain) - displayWidth(weekPlain));
  const headerContent = useColor
    ? `${B}${MM_BLUE}MINIMAX${R}  ${D}${L.dashboard}${R}${' '.repeat(headerGap)}${D}${L.week}:${R} ${MM_CYAN}${weekRange}${R}`
    : `${titlePlain}${' '.repeat(headerGap)}${weekPlain}`;
  const headerVisLen = displayWidth(titlePlain) + headerGap + displayWidth(weekPlain);

  console.log('');
  console.log(boxLine(W, '╭', '─', '╮', useColor));
  console.log(boxRow(headerContent, W, headerVisLen, useColor));

  if (models.length === 0) {
    console.log(boxLine(W, '╰', '─', '╯', useColor));
    console.log(`\n  ${L.noData}\n`);
    return;
  }

  for (const row of rows) {
    console.log(boxLine(W, '├', '─', '┤', useColor));

    const name = useColor ? `${B}${row.displayName}${R}` : row.displayName;
    const line = `${name}${' '.repeat(Math.max(1, nameWidth - displayWidth(row.displayName) + 2))}` +
      `${row.current}${' '.repeat(Math.max(1, currentWidth - displayWidth(row.current) + 2))}` +
      `${row.weekly}${' '.repeat(Math.max(1, weeklyWidth - displayWidth(row.weekly) + 2))}` +
      row.reset;
    console.log(boxRow(line, W, displayWidth(line), useColor));
  }

  console.log(boxLine(W, '╰', '─', '╯', useColor));
  console.log('');
}
