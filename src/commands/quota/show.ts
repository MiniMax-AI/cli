import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { quotaEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { formatTable } from '../../output/text';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

interface ModelRemain {
  model_name: string;
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
}

interface QuotaApiResponse {
  model_remains: ModelRemain[];
}

// ── ANSI color constants (MiniMax brand palette) ──

const R = '\x1b[0m';       // reset
const B = '\x1b[1m';       // bold
const D = '\x1b[2m';       // dim
const MM_BLUE = '\x1b[38;2;43;82;255m';
const MM_CYAN = '\x1b[38;2;6;184;212m';
const WHITE = '\x1b[38;2;255;255;255m';

// Foreground colors for text (percentage label)
const FG_GREEN = '\x1b[38;2;74;222;128m';   // #4ADE80  — remaining > 50%
const FG_YELLOW = '\x1b[38;2;250;204;21m';  // #FACC15  — remaining 20-50%
const FG_RED = '\x1b[38;2;248;113;113m';     // #F87171  — remaining < 20%

// Background colors for battery-style bar fill
const BG_GREEN = '\x1b[48;2;22;163;74m';    // #16A34A
const BG_YELLOW = '\x1b[48;2;202;138;4m';   // #CA8A04
const BG_RED = '\x1b[48;2;220;38;38m';       // #DC2626
const BG_EMPTY = '\x1b[48;2;55;65;81m';     // #374151  — dark grey (consumed track)

// Usage-level colors: low usage = green (good), high usage = red (warning)
function usageColors(usedPct: number): [string, string] {
  if (usedPct < 50) return [FG_GREEN, BG_GREEN];
  if (usedPct <= 80) return [FG_YELLOW, BG_YELLOW];
  return [FG_RED, BG_RED];
}

// ── i18n labels (CN vs Global) ──

interface Labels {
  dashboard: string;
  week: string;
  weekly: string;
  resetsIn: string;
  noData: string;
  now: string;
}

const LABELS_EN: Labels = {
  dashboard: 'Quota Dashboard',
  week: 'Week',
  weekly: 'Weekly',
  resetsIn: 'Resets in',
  noData: 'No quota data available.',
  now: 'now',
};

const LABELS_CN: Labels = {
  dashboard: '配额面板',
  week: '周期',
  weekly: '每周',
  resetsIn: '重置于',
  noData: '暂无配额数据',
  now: '即将',
};

function formatDuration(ms: number, nowLabel: string): string {
  if (ms <= 0) return nowLabel;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ── Terminal display-width helper (CJK chars = 2 columns) ──

function isCJK(code: number): boolean {
  return (
    (code >= 0x2E80 && code <= 0x9FFF) ||   // CJK Radicals .. CJK Unified Ideographs
    (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (code >= 0xFE30 && code <= 0xFE4F) ||   // CJK Compatibility Forms
    (code >= 0xFF01 && code <= 0xFF60) ||   // Fullwidth Forms
    (code >= 0x20000 && code <= 0x2FA1F)    // CJK Unified Ideographs Extension B+
  );
}

/** Visible column width of a plain string (ANSI-stripped, CJK = 2 cols) */
function displayWidth(s: string): number {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) {
    w += isCJK(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

// ── Progress bar renderer (usage-style) ──

const BAR_WIDTH = 16;

/**
 * Usage bar: shows HOW MUCH quota has been consumed.
 * - Colored filled blocks = used portion
 * - Dark grey = remaining capacity
 * @param usedPct - used percentage (0–100)
 */
function renderBar(usedPct: number, color: boolean): string {
  const ratio = Math.max(0, Math.min(100, usedPct)) / 100;
  const filled = Math.round(BAR_WIDTH * ratio);
  const empty = BAR_WIDTH - filled;
  const pctStr = `${usedPct}%`.padStart(4);

  if (!color) {
    // Plain-text: [████............]  1%
    return `[${'█'.repeat(filled)}${'.'.repeat(empty)}] ${pctStr}`;
  }

  const [fg, bg] = usageColors(usedPct);
  // Filled = consumed portion (colored), Empty = remaining (dark grey)
  return (
    `${bg}${' '.repeat(filled)}${R}` +
    `${BG_EMPTY}${' '.repeat(empty)}${R}` +
    ` ${fg}${B}${pctStr}${R}`
  );
}

// ── Box-drawing helpers ──

function line(w: number, left: string, fill: string, right: string, color: boolean): string {
  if (!color) return `+${'-'.repeat(w)}+`;
  return `${D}${left}${fill.repeat(w)}${right}${R}`;
}

function boxTop(w: number, c: boolean): string { return line(w, '╭', '─', '╮', c); }
function boxMid(w: number, c: boolean): string { return line(w, '├', '─', '┤', c); }
function boxBot(w: number, c: boolean): string { return line(w, '╰', '─', '╯', c); }

function boxRow(content: string, innerW: number, visLen: number, color: boolean): string {
  const pad = Math.max(0, innerW - 2 - visLen);
  return color
    ? `${D}│${R} ${content}${' '.repeat(pad)} ${D}│${R}`
    : `| ${content}${' '.repeat(pad)} |`;
}

// visLen removed — use displayWidth() instead for CJK-safe column counting

// ── Command definition ──

export default defineCommand({
  name: 'quota show',
  description: 'Display Token Plan usage and remaining quotas',
  usage: 'minimax quota show',
  examples: [
    'minimax quota show',
    'minimax quota show --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    if (config.dryRun) {
      console.log('Would fetch quota information.');
      return;
    }

    const url = quotaEndpoint(config.baseUrl);
    const response = await requestJson<QuotaApiResponse>(config, { url });
    const models = response.model_remains || [];
    // Only honour explicit --output flag; ignore config-file output setting so the
    // rich HUD is shown by default in TTY even when the user has output: json globally.
    const format = detectOutputFormat(flags.output as string | undefined);

    // Step 1: Non-text formats pass through as-is
    if (format !== 'text') {
      console.log(formatOutput(response, format));
      return;
    }

    // Step 2: Quiet mode — machine-parseable TSV
    if (config.quiet) {
      for (const m of models) {
        const remaining = m.current_interval_total_count - m.current_interval_usage_count;
        console.log(`${m.model_name}\t${m.current_interval_usage_count}\t${m.current_interval_total_count}\t${remaining}`);
      }
      return;
    }

    // Step 3: Rich HUD — locale + color detection
    const useColor = !config.noColor && process.stdout.isTTY === true;
    const L = config.region === 'cn' ? LABELS_CN : LABELS_EN;

    // Dynamic box width: adapt to longest model name
    const maxNameLen = models.length > 0
      ? Math.max(...models.map(m => m.model_name.length))
      : 16;
    // color bar:    BAR_WIDTH spaces + ' ' + pct(4)        = BAR_WIDTH + 5 visible cols
    // no-color bar: '[' + BAR_WIDTH chars + '] ' + pct(4)  = BAR_WIDTH + 7 visible cols
    const barVisLen = useColor ? BAR_WIDTH + 5 : BAR_WIDTH + 7;
    // line1 content = name(maxNameLen) + '  '(2) + usage(15) + '  '(2) + bar(barVisLen)
    // W must be content + 2 so boxRow borders ('| ' + ' |') have room
    const W = Math.max(68, maxNameLen + 2 + 15 + 2 + barVisLen + 2);

    // ── Header row ──
    const weekRange = models.length > 0
      ? `${formatDate(models[0]!.weekly_start_time)} — ${formatDate(models[0]!.weekly_end_time)}`
      : '';

    const titlePlain = `MINIMAX  ${L.dashboard}`;
    const weekPlain = `${L.week}: ${weekRange}`;
    // Use displayWidth for CJK-safe column counting
    const titleDW = displayWidth(titlePlain);
    const weekDW = displayWidth(weekPlain);
    const headerGap = Math.max(2, W - 2 - titleDW - weekDW);

    const titleStyled = useColor
      ? `${B}${MM_BLUE}MINIMAX${R}  ${D}${L.dashboard}${R}`
      : titlePlain;
    const weekStyled = useColor
      ? `${D}${L.week}:${R} ${MM_CYAN}${weekRange}${R}`
      : weekPlain;

    const headerContent = `${titleStyled}${' '.repeat(headerGap)}${weekStyled}`;
    const headerVisLen = titleDW + headerGap + weekDW;

    console.log('');
    console.log(boxTop(W, useColor));
    console.log(boxRow(headerContent, W, headerVisLen, useColor));

    if (models.length === 0) {
      console.log(boxBot(W, useColor));
      console.log(`\n  ${L.noData}\n`);
      return;
    }

    // ── Model rows (each wrapped inside the same box) ──
    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      console.log(boxMid(W, useColor));

      // API field "usage_count" is actually the REMAINING count
      const remaining = m.current_interval_usage_count;
      const limit = m.current_interval_total_count;
      const used = Math.max(0, limit - remaining);
      const usedPct = limit > 0 ? Math.round((used / limit) * 100) : 0;
      const weekRemaining = m.current_weekly_usage_count;
      const weekLimit = m.current_weekly_total_count;
      const weekUsed = Math.max(0, weekLimit - weekRemaining);
      const resets = formatDuration(m.remains_time, L.now);

      // Line 1: Model name + used/limit fraction + battery bar + remaining %
      const nameStr = m.model_name.padEnd(maxNameLen);
      const usageFrac = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
      const bar = renderBar(usedPct, useColor);

      // color bar:    BAR_WIDTH spaces + gap(1) + pct(4)       = BAR_WIDTH + 5
      // no-color bar: '[' + BAR_WIDTH chars + '] ' + pct(4)   = BAR_WIDTH + 7
      const line1VisLen = maxNameLen + 2 + 15 + 2 + barVisLen;

      let line1Styled: string;
      if (useColor) {
        const [fg] = usageColors(usedPct);
        line1Styled = `${B}${WHITE}${nameStr}${R}  ${fg}${usageFrac.padStart(15)}${R}  ${bar}`;
      } else {
        line1Styled = `${nameStr}  ${usageFrac.padStart(15)}  ${renderBar(usedPct, false)}`;
      }
      console.log(boxRow(line1Styled, W, line1VisLen, useColor));

      // Line 2: Weekly stats (left) + reset timer (right-aligned)
      const weekFrac = `${weekUsed.toLocaleString()} / ${weekLimit.toLocaleString()}`;
      const subLeft = `└ ${L.weekly} ${weekFrac}`;
      const subRight = `${L.resetsIn} ${resets}`;
      const subLeftDW = displayWidth(subLeft);
      const subRightDW = displayWidth(subRight);
      // Inner width = W - 2 (box borders), minus 2 leading spaces, minus left & right content
      const subGap = Math.max(2, (W - 2) - 2 - subLeftDW - subRightDW);
      const subPlain = `  ${subLeft}${' '.repeat(subGap)}${subRight}`;
      const subVisLen = 2 + subLeftDW + subGap + subRightDW;

      const subStyled = useColor
        ? `  ${D}${subLeft}${' '.repeat(subGap)}${subRight}${R}`
        : subPlain;
      console.log(boxRow(subStyled, W, subVisLen, useColor));
    }

    console.log(boxBot(W, useColor));
    console.log('');
  },
});
