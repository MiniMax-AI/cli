import { resolveQuotaCounts } from '../utils/quota';
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
  if (ms < 60000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Compact tag for the quota window length shown next to the reset countdown,
// e.g. a 5-hour rolling window ⇒ "5h", a daily window ⇒ "1d", weekly ⇒ "1w".
function formatWindow(ms: number): string {
  const WEEK = 7 * 24 * 3600000;
  const DAY = 24 * 3600000;
  const HOUR = 3600000;
  if (ms <= 0) return '';
  if (ms % WEEK === 0) return `${ms / WEEK}w`;
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms >= HOUR) return `${Math.round(ms / HOUR)}h`;
  return `${Math.max(1, Math.round(ms / 60000))}m`;
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

// Display ceiling. Server returns base percent (0–100) plus a `weekly_boost_permille`
// multiplier; a typical boosted plan shows up to 150%, so cap the rendered value
// at 200% to leave headroom and keep the bar/text readable.
const MAX_DISPLAY_PCT = 200;

// Weekly quota is unlimited when the server reports `current_weekly_status: 3`
// (per the status enum: 1=normal, 2=exhausted, 3=unlimited).
function isUnweekly(status: number | undefined | null): boolean {
  return status === 3;
}

function isUnavailablePlan(model: QuotaModelRemain): boolean {
  // Weekly status 3 is normally unlimited. When both windows are status 3 and
  // both totals are zero, however, the API uses the same status for a model
  // that has no quota bucket in the current plan (see issue #173).
  return model.current_interval_total_count === 0
    && model.current_weekly_total_count === 0
    && model.current_interval_status === 3
    && model.current_weekly_status === 3;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(MAX_DISPLAY_PCT, Math.round(value)));
}

function boostFactor(boostPermille: number | undefined | null): number {
  if (boostPermille === undefined || boostPermille === null) return 1;
  return Math.max(0, boostPermille) / 1000;
}

function remainingPct(
  percent: number | undefined | null,
  remaining: number,
  total: number,
  boostPermille?: number | null,
): number {
  const factor = boostFactor(boostPermille);
  if (percent !== undefined && percent !== null) {
    return clampPct(percent * factor);
  }
  return total > 0 ? clampPct((remaining / total) * 100 * factor) : 0;
}

function renderBar(remainingPct: number, color: boolean, barWidth: number = BAR_WIDTH, showPct: boolean = true): string {
  const pct = clampPct(remainingPct);
  const ratio = Math.min(1, pct / 100);
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

const UNLIMITED_SYMBOL = '∞';
const UNLIMITED_LABEL_CN = '无限';
const UNLIMITED_LABEL_EN = 'unlimited';

function renderMetric(
  label: string,
  reportedCount: number,
  total: number,
  percent: number | undefined | null,
  color: boolean,
  boostPermille?: number | null,
  unlimited?: boolean,
  unlimitedLabel?: string,
): string {
  if (unlimited) {
    const ul = unlimitedLabel ?? UNLIMITED_SYMBOL;
    const ulStr = ul.padStart(4);
    if (color) {
      const bar = `${BG_GREEN}${' '.repeat(COMPACT_BAR_WIDTH)}${R}`;
      return `${D}${label}${R} ${bar} ${FG_GREEN}${B}${ulStr}${R}`;
    }
    const bar = `[${'█'.repeat(COMPACT_BAR_WIDTH)}]`;
    return `${label} ${bar} ${ulStr}`;
  }
  const pct = remainingPct(percent, reportedCount, total, boostPermille);
  const counts = resolveQuotaCounts(reportedCount, total, percent);
  const bar = renderBar(pct, color, COMPACT_BAR_WIDTH, counts === undefined);
  if (counts) {
    const count = `${counts.remaining.toLocaleString()} / ${counts.total.toLocaleString()}`;
    return color ? `${D}${label}${R} ${bar} ${remainingColors(pct)[0]}${count}${R}` : `${label} ${bar} ${count}`;
  }
  return `${label} ${bar}`;
}

function renderUnavailableMetric(label: string, unavailableLabel: string, color: boolean): string {
  if (color) {
    const bar = `${BG_EMPTY}${' '.repeat(COMPACT_BAR_WIDTH)}${R}`;
    return `${D}${label}${R} ${bar} ${FG_RED}${B}${unavailableLabel}${R}`;
  }
  return `${label} [${'.'.repeat(COMPACT_BAR_WIDTH)}] ${unavailableLabel}`;
}

// `div` is a 1-based offset (in display cells) of an optional column divider,
// so the reset column can be boxed off: ├────┬────┤ / ├────┼────┤ / ╰────┴────╯.
function boxLine(w: number, l: string, f: string, r: string, c: boolean, div?: number, divChar?: string): string {
  if (div === undefined || divChar === undefined) {
    return c ? `${D}${l}${f.repeat(w)}${r}${R}` : `+${'-'.repeat(w)}+`;
  }
  return c
    ? `${D}${l}${f.repeat(div - 1)}${divChar}${f.repeat(w - div)}${r}${R}`
    : `+${'-'.repeat(div - 1)}+${'-'.repeat(w - div)}+`;
}

function boxRow(content: string, innerW: number, visLen: number, color: boolean): string {
  const pad = Math.max(0, innerW - 2 - visLen);
  return color ? `${D}│${R} ${content}${' '.repeat(pad)} ${D}│${R}` : `| ${content}${' '.repeat(pad)} |`;
}

export function renderQuotaTable(models: QuotaModelRemain[], config: Config): void {
  const useColor = !config.noColor && process.stdout.isTTY === true;
  const L = config.region === 'cn' ? LABELS_CN : LABELS_EN;

  const rows = models.map((m) => {
    const displayName = displayModelName(m.model_name, config.region);
    const unavailable = isUnavailablePlan(m);
    const current = unavailable
      ? renderUnavailableMetric(L.current, L.notInPlan, useColor)
      : renderMetric(
        L.current,
        m.current_interval_usage_count,
        m.current_interval_total_count,
        m.current_interval_remaining_percent,
        useColor,
      );
    const weekly = unavailable
      ? renderUnavailableMetric(L.weekly, L.notInPlan, useColor)
      : renderMetric(
        L.weekly,
        m.current_weekly_usage_count,
        m.current_weekly_total_count,
        m.current_weekly_remaining_percent,
        useColor,
        m.weekly_boost_permille,
        isUnweekly(m.current_weekly_status),
        config.region === 'cn' ? UNLIMITED_LABEL_CN : UNLIMITED_LABEL_EN,
      );
    // The reset countdown lives in its own boxed column; the dim window tag
    // ("5h", "1w", …) tells which quota window the countdown applies to.
    const windowTag = unavailable ? '' : formatWindow(m.end_time - m.start_time);
    const resetLabel = windowTag ? `${windowTag} ${L.resetsIn}` : L.resetsIn;
    const resetValue = unavailable ? '—' : formatDuration(m.remains_time, L.now);
    const reset = useColor ? `${D}${resetLabel}${R} ${resetValue}` : `${resetLabel} ${resetValue}`;
    return { displayName, current, weekly, reset };
  });

  const nameWidth = Math.max(6, ...rows.map(r => displayWidth(r.displayName)));
  const currentWidth = Math.max(...rows.map(r => displayWidth(r.current)), 18);
  const weeklyWidth = Math.max(...rows.map(r => displayWidth(r.weekly)), 18);
  const resetWidth = Math.max(...rows.map(r => displayWidth(r.reset)), 10);
  // Left section holds name + current + weekly; the reset column sits to the
  // right of the divider. Keep the historical 72-cell minimum by widening the
  // left section when the natural width falls short.
  let leftWidth = nameWidth + 2 + currentWidth + 2 + weeklyWidth;
  let W = leftWidth + 3 + resetWidth + 2;
  if (W < 72) {
    leftWidth += 72 - W;
    W = 72;
  }
  const divOffset = leftWidth + 3;

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

  rows.forEach((row, i) => {
    console.log(boxLine(W, '├', '─', '┤', useColor, divOffset, i === 0 ? '┬' : '┼'));

    const name = useColor ? `${B}${row.displayName}${R}` : row.displayName;
    const left = `${name}${' '.repeat(Math.max(1, nameWidth - displayWidth(row.displayName) + 2))}` +
      `${row.current}${' '.repeat(Math.max(1, currentWidth - displayWidth(row.current) + 2))}` +
      row.weekly;
    const divider = useColor ? `${D}│${R}` : '|';
    const line = `${left}${' '.repeat(Math.max(0, leftWidth - displayWidth(left)))} ${divider} ${row.reset}`;
    console.log(boxRow(line, W, displayWidth(line), useColor));
  });

  console.log(boxLine(W, '╰', '─', '╯', useColor, divOffset, '┴'));
  console.log('');
}
