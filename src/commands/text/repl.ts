import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { isInteractive } from '../../utils/env';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function cursorUp(n: number): string   { return `\x1b[${n}A`; }
function cursorDown(n: number): string { return `\x1b[${n}B`; }
function cursorCol(n: number): string  { return `\x1b[${n}G`; }
function clearLine(): string           { return '\x1b[2K'; }
function clearBelow(): string          { return '\x1b[0J'; }
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ---------------------------------------------------------------------------
// Custom line editor — raw-mode keypress handling with full render control
// ---------------------------------------------------------------------------

class LineEditor {
  private buffer = '';
  private cursor = 0;
  private history: string[] = [];
  private historyIdx = -1;

  private out: NodeJS.WriteStream;
  private promptLen: number;
  private dim: string;
  private reset: string;
  private width: number;

  private lastTotal = 0;
  private resolve: ((value: string) => void) | null = null;

  constructor(out: NodeJS.WriteStream, prompt: string, dim: string, reset: string) {
    this.out = out;
    this.promptLen = prompt.length;
    this.dim = dim;
    this.reset = reset;
    this.width = out.columns || 80;
  }

  readLine(): Promise<string> {
    return new Promise(resolve => {
      this.buffer = '';
      this.cursor = 0;
      this.lastTotal = 0;
      this.resolve = resolve;
      this.render();
    });
  }

  feed(data: Buffer): void {
    const raw = data.toString();
    let i = 0;

    while (i < raw.length) {
      const ch = raw[i];

      // ---- Escape sequences (arrow keys, delete, home, end) ----
      if (ch === '\x1b' && i + 1 < raw.length && raw[i + 1] === '[') {
        const seq = raw.slice(i, i + 3);
        if (seq === '\x1b[A') { this.historyUp(); i += 3; continue; }
        if (seq === '\x1b[B') { this.historyDown(); i += 3; continue; }
        if (seq === '\x1b[C') { if (this.cursor < this.buffer.length) this.cursor++; this.render(); i += 3; continue; }
        if (seq === '\x1b[D') { if (this.cursor > 0) this.cursor--; this.render(); i += 3; continue; }
        if (seq === '\x1b[H') { this.cursor = 0; this.render(); i += 3; continue; }
        if (seq === '\x1b[F') { this.cursor = this.buffer.length; this.render(); i += 3; continue; }
        if (i + 3 < raw.length && raw.slice(i, i + 4) === '\x1b[3~') {
          if (this.cursor < this.buffer.length) {
            this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          }
          this.render();
          i += 4;
          continue;
        }
        i += 1;
        continue;
      }

      // ---- Enter ----
      if (ch === '\r' || ch === '\n') {
        const line = this.buffer;
        if (line.trim()) {
          this.history.push(line);
          this.historyIdx = -1;
        }
        const linesBelow = this.lastTotal > 0 ? this.lastTotal - 1 : 0;
        this.out.write(cursorDown(linesBelow) + '\n');
        this.lastTotal = 0;
        const cb = this.resolve;
        this.resolve = null;
        cb!(line);
        i++;
        continue;
      }

      // ---- Backspace ----
      if (ch === '\x7f' || ch === '\b') {
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
        }
        this.render();
        i++;
        continue;
      }

      // ---- Ctrl+A / Ctrl+E ----
      if (ch === '\x01') { this.cursor = 0; this.render(); i++; continue; }
      if (ch === '\x05') { this.cursor = this.buffer.length; this.render(); i++; continue; }

      // ---- Ctrl+U: kill line ----
      if (ch === '\x15') {
        this.buffer = '';
        this.cursor = 0;
        this.render();
        i++;
        continue;
      }

      // ---- Ctrl+W: kill word ----
      if (ch === '\x17') {
        const before = this.buffer.slice(0, this.cursor);
        const after  = this.buffer.slice(this.cursor);
        const trimmed = before.replace(/\S+\s*$/, '');
        this.cursor = trimmed.length;
        this.buffer = trimmed + after;
        this.render();
        i++;
        continue;
      }

      // ---- Printable characters ----
      if (ch.charCodeAt(0) >= 32) {
        this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
        this.cursor++;
        this.render();
        i++;
        continue;
      }

      i++;
    }
  }

  // ---- history navigation ----

  private historyUp(): void {
    if (this.history.length === 0) return;
    if (this.historyIdx === -1) this.historyIdx = this.history.length - 1;
    else if (this.historyIdx > 0) this.historyIdx--;
    this.buffer = this.history[this.historyIdx];
    this.cursor = this.buffer.length;
    this.render();
  }

  private historyDown(): void {
    if (this.historyIdx === -1) return;
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.buffer = this.history[this.historyIdx];
    } else {
      this.historyIdx = -1;
      this.buffer = '';
    }
    this.cursor = this.buffer.length;
    this.render();
  }

  // ---- Rendering ----

  private border(): string {
    return this.dim + '\u2500'.repeat(this.width) + this.reset;
  }

  /**
   * Layout:
   *   ─────────────────  (top border)
   *   > input text       (input line)
   *   ─────────────────  (bottom border)
   */
  private render(): void {
    const suggestionCount = 0; // reserved for future /-command suggestions
    const newTotal = 3 + suggestionCount;

    let out = '';

    // Move cursor up to the top border (cursor currently sits on input line)
    if (this.lastTotal > 0) {
      out += cursorUp(1);
    }

    out += cursorCol(1) + clearLine() + this.border() + '\n';
    out += clearLine() + '> ' + this.buffer + '\n';
    out += cursorCol(1) + clearLine() + this.border() + '\n';

    if (newTotal < this.lastTotal) {
      out += clearBelow();
    }

    // Move cursor back to input line
    out += cursorUp(suggestionCount + 2);
    out += cursorCol(this.promptLen + this.cursor + 1);

    this.out.write(out);
    this.lastTotal = newTotal;
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export default defineCommand({
  name: 'text repl',
  description: 'Start an interactive multi-turn chat session',
  usage: 'mmx text repl [flags]',
  options: [
    { flag: '--model <model>',     description: 'Model ID (default: MiniMax-M2.7)' },
    { flag: '--system <text>',     description: 'System prompt' },
    { flag: '--max-tokens <n>',    description: 'Maximum tokens per response (default: 4096)', type: 'number' },
    { flag: '--temperature <n>',   description: 'Sampling temperature (0.0, 1.0]', type: 'number' },
    { flag: '--top-p <n>',         description: 'Nucleus sampling threshold', type: 'number' },
  ],
  examples: [
    'mmx text repl',
    'mmx text repl --model MiniMax-M2.7-highspeed --system "You are a coding assistant."',
    'mmx text repl --temperature 0.7 --max-tokens 8192',
  ],
  async run(config: Config, flags: GlobalFlags) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      throw new CLIError(
        'The repl command requires an interactive terminal.',
        ExitCode.USAGE,
        'mmx text repl',
      );
    }

    if (!process.stdin.isTTY) {
      throw new CLIError('The repl command requires a TTY.', ExitCode.USAGE);
    }

    const dim  = config.noColor ? '' : '\x1b[2m';
    const reset = config.noColor ? '' : '\x1b[0m';

    process.stdout.write(`\nMiniMax Chat REPL\n`);
    process.stdout.write(`${dim}Type /exit to quit.${reset}\n`);

    const stdin = process.stdin;
    const stdout = process.stdout;

    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    const editor = new LineEditor(stdout, '> ', dim, reset);
    let running = true;

    stdin.on('data', (data: Buffer) => {
      editor.feed(data);
    });

    stdout.write(HIDE_CURSOR);

    try {
      while (running) {
        const line = await editor.readLine();

        if (!running) break;

        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed === '/exit') {
          stdout.write(`${dim}Goodbye!${reset}\n`);
          running = false;
          break;
        }

        // Placeholder: echo back until chat integration is added
        stdout.write(`You said: ${trimmed}\n`);
      }
    } finally {
      stdout.write(SHOW_CURSOR);
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false);
      }
      stdin.pause();
      stdin.removeAllListeners('data');
      stdout.write('\n');
    }
  },
});
