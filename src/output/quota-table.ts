import type { Config } from '../config/schema';
import type { QuotaModelRemain } from '../types/api';

// ── ANSI color constants ──

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const MM_BLUE = '\x1b[38;2;43;82;255m';
const MM_CYAN = '\x1b[38;2;6;184;212m';
const WHITE = '\x1b[38;2;255;255;255m';
const FG_GREEN = '\x1b[38;2;74;222;128m';
const FG_YELLOW = '\x1b[38;2;250;204;21m';
const FG_RED = '\x1b[38;2;248;113;113m';
const BG_GREEN = '\x1b[48;2;22;163;74m';
const BG_YELLOW = '\x1b[48;2;202;138;4m';
const BG_RED = '\x1b[48;2;220;38;38m';
const BG_EMPTY = '\x1b[48;2;55;65;81m';

function usageColors(usedPct: number): [string, string] {
  if (usedPct < 50) return [FG_GREEN, BG_GREEN];
  if (usedPct <= 80) return [FG_YELLOW, BG_YELLOW];
  return [FG_RED, BG_RED];
}

interface Labels {
  dashboard: string;
  week: string;
  weekly: string;
  resetsIn: string;
  noData: string;
  now: string;
}

const LABELS_EN: Labels = { dashboard: 'Quota Dashboard', week: 'Week', weekly: 'Weekly', resetsIn: 'Resets in', noData: 'No quota data available.', now: 'now' };
const LABELS_CN: Labels = { dashboard: '配额面板', week: '周期', weekly: '每周', resetsIn: '重置于', noData: '暂无配额数据', now: '即将' };

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

function renderBar(usedPct: number, color: boolean): string {
  const ratio = Math.max(0, Math.min(100, usedPct)) / 100;
  const filled = Math.round(BAR_WIDTH * ratio);
  const empty = BAR_WIDTH - filled;
  const pctStr = `${usedPct}%`.padStart(4);
  if (!color) return `[${'█'.repeat(filled)}${'.'.repeat(empty)}] ${pctStr}`;
  const [fg, bg] = usageColors(usedPct);
  return `${bg}${' '.repeat(filled)}${R}${BG_EMPTY}${' '.repeat(empty)}${R} ${fg}${B}${pctStr}${R}`;
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

  const maxNameLen = models.length > 0 ? Math.max(...models.map(m => m.model_name.length)) : 16;
  const barVisLen = useColor ? BAR_WIDTH + 5 : BAR_WIDTH + 7;
  const W = Math.max(68, maxNameLen + 2 + 15 + 2 + barVisLen + 2);

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

  for (const m of models) {
    console.log(boxLine(W, '├', '─', '┤', useColor));

    const remaining = m.current_interval_usage_count;
    const limit = m.current_interval_total_count;
    const used = Math.max(0, limit - remaining);
    const usedPct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    const weekRemaining = m.current_weekly_usage_count;
    const weekLimit = m.current_weekly_total_count;
    const weekUsed = Math.max(0, weekLimit - weekRemaining);
    const resets = formatDuration(m.remains_time, L.now);

    const nameStr = m.model_name.padEnd(maxNameLen);
    const usageFrac = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
    const bar = renderBar(usedPct, useColor);
    const line1VisLen = maxNameLen + 2 + 15 + 2 + barVisLen;

    const line1 = useColor
      ? `${B}${WHITE}${nameStr}${R}  ${usageColors(usedPct)[0]}${usageFrac.padStart(15)}${R}  ${bar}`
      : `${nameStr}  ${usageFrac.padStart(15)}  ${renderBar(usedPct, false)}`;
    console.log(boxRow(line1, W, line1VisLen, useColor));

    const subLeft = `└ ${L.weekly} ${weekUsed.toLocaleString()} / ${weekLimit.toLocaleString()}`;
    const subRight = `${L.resetsIn} ${resets}`;
    const subGap = Math.max(2, (W - 2) - 2 - displayWidth(subLeft) - displayWidth(subRight));
    const subVisLen = 2 + displayWidth(subLeft) + subGap + displayWidth(subRight);
    const sub = useColor
      ? `  ${D}${subLeft}${' '.repeat(subGap)}${subRight}${R}`
      : `  ${subLeft}${' '.repeat(subGap)}${subRight}`;
    console.log(boxRow(sub, W, subVisLen, useColor));
  }

  console.log(boxLine(W, '╰', '─', '╯', useColor));
  console.log('');
}
