import { defineCommand } from '../../command';
import { request } from '../../client/http';
import { chatEndpoint } from '../../client/endpoints';
import { parseSSE } from '../../client/stream';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { isInteractive } from '../../utils/env';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { ChatMessage, ChatRequest, StreamEvent } from '../../types/api';
import { writeFileSync } from 'node:fs';

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
// Slash commands
// ---------------------------------------------------------------------------

const SLASH_COMMANDS: Record<string, string> = {
  '/exit':    'Exit the conversation',
  '/clear':   'Clear conversation history (keeps system prompt)',
  '/system':  'Show or set the system prompt. Usage: /system [new prompt]',
  '/model':   'Show or set the model. Usage: /model [model-id]',
  '/save':    'Save conversation to a JSON file. Usage: /save <path>',
  '/help':    'Show available slash commands',
  '/history': 'Show conversation messages with content preview',
};

const SLASH_KEYS = Object.keys(SLASH_COMMANDS);
const CMD_MAX_LEN = Math.max(...SLASH_KEYS.map(k => k.length));

function showHelp(): void {
  process.stdout.write('\nAvailable commands:\n');
  for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
    process.stdout.write(`  ${cmd.padEnd(CMD_MAX_LEN + 2)} ${desc}\n`);
  }
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

interface ReplState {
  messages: ChatMessage[];
  system: string | undefined;
  model: string;
  maxTokens: number;
  temperature: number | undefined;
  topP: number | undefined;
}

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
        if (cb) cb(line);
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

      // ---- Tab: auto-complete slash command ----
      if (ch === '\t') {
        if (this.buffer.startsWith('/')) {
          const hits = SLASH_KEYS.filter(cmd => cmd.startsWith(this.buffer));
          if (hits.length === 1) {
            this.buffer = hits[0];
            this.cursor = this.buffer.length;
            this.render();
          }
        }
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
   *   /cmd1  desc        (suggestions — outside input area)
   *   /cmd2  ...
   */
  private render(): void {
    // Compute slash-command suggestions in real time
    const hits = this.buffer.startsWith('/')
      ? SLASH_KEYS.filter(cmd => cmd.startsWith(this.buffer))
      : [];
    const exactMatch = hits.length === 1 && hits[0] === this.buffer;
    const showSuggestions = hits.length > 0 && !exactMatch;
    const suggestionCount = showSuggestions ? hits.length : 0;
    const newTotal = 3 + suggestionCount;

    let out = '';

    // Move cursor up to the top border (cursor currently sits on input line)
    if (this.lastTotal > 0) {
      out += cursorUp(1);
    }

    out += cursorCol(1) + clearLine() + this.border() + '\n';
    out += clearLine() + '> ' + this.buffer + '\n';
    out += cursorCol(1) + clearLine() + this.border() + '\n';

    // Suggestions — rendered below the bottom border, outside the input area
    if (showSuggestions) {
      for (const cmd of hits) {
        out += clearLine() +
          `  ${this.dim}${cmd.padEnd(CMD_MAX_LEN + 2)} ${SLASH_COMMANDS[cmd]}${this.reset}\n`;
      }
    }

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

    // ---- Initialize state ----
    const state: ReplState = {
      messages: [],
      system: flags.system as string | undefined,
      model: (flags.model as string) || config.defaultTextModel || 'MiniMax-M2.7',
      maxTokens: (flags.maxTokens as number) ?? 4096,
      temperature: flags.temperature !== undefined ? flags.temperature as number : undefined,
      topP: flags.topP !== undefined ? flags.topP as number : undefined,
    };

    const bold = config.noColor ? '' : '\x1b[1m';

    process.stdout.write(`\n${bold}MiniMax Chat REPL${reset}\n`);
    process.stdout.write(`${dim}Model: ${state.model}${reset}\n`);
    if (state.system) {
      process.stdout.write(`${dim}System: ${state.system.slice(0, 80)}${state.system.length > 80 ? '...' : ''}${reset}\n`);
    }
    process.stdout.write(`${dim}Type / to see commands, /exit to quit.${reset}\n`);

    const stdin = process.stdin;
    const stdout = process.stdout;

    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    let waitingForResponse = false;
    let sigintCount = 0;

    // ---- Helper: send messages and stream response ----
    async function sendMessages(): Promise<void> {
      if (state.messages.length === 0) {
        stdout.write(`${dim}No messages to send. Type something first.${reset}\n`);
        return;
      }

      const body: ChatRequest = {
        model: state.model,
        messages: state.messages,
        max_tokens: state.maxTokens,
        stream: true,
      };
      if (state.system) body.system = state.system;
      if (state.temperature !== undefined) body.temperature = state.temperature;
      if (state.topP !== undefined) body.top_p = state.topP;

      waitingForResponse = true;
      const url = chatEndpoint(config.baseUrl);

      try {
        const res = await request(config, {
          url,
          method: 'POST',
          body,
          stream: true,
          authStyle: 'x-api-key',
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream') && !contentType.includes('stream')) {
          throw new CLIError(
            `Expected SSE stream but got content-type "${contentType}".`,
            ExitCode.GENERAL,
          );
        }

        let textContent = '';
        let inThinking = false;

        for await (const event of parseSSE(res)) {
          if (event.data === '[DONE]') break;
          try {
            const parsed = JSON.parse(event.data) as StreamEvent;

            if (parsed.type === 'content_block_start') {
              if (parsed.content_block.type === 'thinking') {
                inThinking = true;
                stdout.write(`${dim}Thinking:\n`);
              } else if (parsed.content_block.type === 'text' && inThinking) {
                stdout.write(`${reset}\nResponse:\n`);
                inThinking = false;
              }
            } else if (parsed.type === 'content_block_delta') {
              if (parsed.delta.type === 'text_delta') {
                textContent += parsed.delta.text;
                stdout.write(parsed.delta.text);
              } else if (parsed.delta.type === 'thinking_delta') {
                stdout.write(parsed.delta.thinking);
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }

        if (inThinking) stdout.write(reset);

        if (textContent) {
          state.messages.push({ role: 'assistant', content: textContent });
          stdout.write('\n');
        } else {
          stdout.write(`${dim}[empty response]${reset}\n`);
        }
      } catch (err) {
        stdout.write(`${dim}[error] ${err instanceof Error ? err.message : String(err)}${reset}\n`);
      } finally {
        waitingForResponse = false;
        sigintCount = 0;
      }
    }

    // ---- Helper: handle slash commands ----
    function handleSlash(input: string): 'exit' | 'ok' {
      const parts = input.trim().split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case '/exit':
          stdout.write(`${dim}Goodbye!${reset}\n`);
          return 'exit';

        case '/help':
          showHelp();
          return 'ok';

        case '/clear':
          state.messages = [];
          stdout.write(`${dim}Conversation cleared.${reset}\n`);
          return 'ok';

        case '/system': {
          if (arg) {
            state.system = arg;
            stdout.write(`${dim}System prompt set.${reset}\n`);
          } else {
            if (state.system) {
              stdout.write(`${dim}System prompt:${reset}\n${state.system}\n`);
            } else {
              stdout.write(`${dim}No system prompt set.${reset}\n`);
            }
          }
          return 'ok';
        }

        case '/model': {
          if (arg) {
            state.model = arg;
            stdout.write(`${dim}Model set to: ${state.model}${reset}\n`);
          } else {
            stdout.write(`${dim}Current model: ${state.model}${reset}\n`);
          }
          return 'ok';
        }

        case '/save': {
          if (!arg) {
            stdout.write(`${dim}Usage: /save <file-path>${reset}\n`);
            return 'ok';
          }
          try {
            const toSave: Array<{ role: string; content: string }> = [];
            if (state.system) toSave.push({ role: 'system', content: state.system });
            for (const m of state.messages) {
              toSave.push({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              });
            }
            writeFileSync(arg, JSON.stringify(toSave, null, 2), 'utf-8');
            stdout.write(`${dim}Conversation saved to ${arg} (${toSave.length} messages)${reset}\n`);
          } catch (err) {
            stdout.write(`${dim}[error] Failed to save: ${err instanceof Error ? err.message : String(err)}${reset}\n`);
          }
          return 'ok';
        }

        case '/history': {
          if (state.messages.length === 0) {
            stdout.write(`${dim}No messages in conversation.${reset}\n`);
            return 'ok';
          }
          if (state.system) {
            stdout.write(`${dim}[system] ${state.system.slice(0, 100)}${state.system.length > 100 ? '...' : ''}${reset}\n`);
          }
          let index = 1;
          for (const m of state.messages) {
            const roleLabel = m.role === 'user' ? 'user' : 'assistant';
            const raw = typeof m.content === 'string' ? m.content : '[structured content]';
            const preview = raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
            const oneline = preview.replace(/\n/g, '\u21B5');
            const prefix = `  ${String(index).padStart(2)} ${roleLabel.padEnd(11)}`;
            stdout.write(`${dim}${prefix}${reset}${oneline}\n`);
            index++;
          }
          stdout.write(`${dim}\u2500\u2500 ${index - 1} messages \u2500\u2500${reset}\n`);
          return 'ok';
        }

        default:
          if (cmd.startsWith('/')) {
            stdout.write(`${dim}Unknown command: ${cmd}. Type /help for available commands.${reset}\n`);
            return 'ok';
          }
          return 'ok';
      }
    }

    // ---- SIGINT handler ----
    const onSigint = () => {
      if (waitingForResponse) {
        stdout.write(`\n${dim}[interrupted]${reset}\n`);
        sigintCount = 0;
        waitingForResponse = false;
        return;
      }
      sigintCount++;
      if (sigintCount >= 2) {
        stdout.write(`\n${dim}Goodbye!${reset}\n`);
        running = false;
        if (typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(false);
        }
        stdin.pause();
        process.removeListener('SIGINT', onSigint);
        process.exit(0);
      } else {
        stdout.write(`\n${dim}Press Ctrl+C again or type /exit to quit.${reset}\n`);
      }
    };

    process.on('SIGINT', onSigint);

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

        if (trimmed.startsWith('/')) {
          const result = handleSlash(trimmed);
          if (result === 'exit') {
            running = false;
            break;
          }
          continue;
        }

        // Normal message
        state.messages.push({ role: 'user', content: trimmed });
        await sendMessages();
      }
    } finally {
      stdout.write(SHOW_CURSOR);
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false);
      }
      stdin.pause();
      process.removeListener('SIGINT', onSigint);
      stdin.removeAllListeners('data');
      stdout.write('\n');
    }
  },
});
