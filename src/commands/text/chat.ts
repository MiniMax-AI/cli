import { defineCommand } from '../../command';
import { request, requestJson } from '../../client/http';
import { chatEndpoint } from '../../client/endpoints';
import { parseSSE } from '../../client/stream';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ContentBlock,
  StreamEvent,
} from '../../types/api';
import { readFileSync } from 'fs';
import { isInteractive } from '../../utils/env';
import { readTextFromPathOrStdin } from '../../utils/fs';
import { promptText, failIfMissing } from '../../utils/prompt';
import { toImageBlock } from '../../utils/image';

// MiniMax Anthropic API contract (platform.minimax.io/docs/api-reference/text-anthropic-api):
// per-image cap, supported formats, and the whole-request-body cap.
const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const CHAT_MAX_REQUEST_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Thinking indicator — dynamic spinner + color-cycling label
// ---------------------------------------------------------------------------

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

class ThinkingIndicator {
  private frame = 0;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private out: NodeJS.WriteStream;
  private noColor: boolean;

  constructor(out: NodeJS.WriteStream, noColor: boolean) {
    this.out = out;
    this.noColor = noColor;
  }

  start(): void {
    this.frame = 0;
    this.startTime = Date.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.out.write('\r\x1b[0K');
  }

  private tick(): void {
    const ch = BRAILLE[this.frame % BRAILLE.length];
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const label = elapsed >= 60
      ? `Thinking (${Math.floor(elapsed / 60)}m ${elapsed % 60}s)`
      : `Thinking (${elapsed}s)`;

    this.frame++;

    if (this.noColor) {
      this.out.write(`\r${ch} ${label}\x1b[0K`);
    } else {
      const [rs, gs, bs] = hslToRgb((this.frame * 17) % 360, 0.85, 0.55);
      // Hue-shift the spinner slightly ahead of the label for contrast
      const [rl, gl, bl] = hslToRgb(((this.frame * 17) + 40) % 360, 0.85, 0.55);
      this.out.write(
        `\r\x1b[38;2;${rs};${gs};${bs}m${ch}\x1b[0m ` +
        `\x1b[38;2;${rl};${gl};${bl}m${label}\x1b[0m\x1b[0K`,
      );
    }
  }
}

interface ParsedMessages {
  system?: string;
  messages: ChatMessage[];
}

function parseMessages(flags: GlobalFlags): ParsedMessages {
  const messages: ChatMessage[] = [];
  let system: string | undefined;

  if (flags.system) {
    system = flags.system as string;
  }

  if (flags.messagesFile) {
    const filePath = flags.messagesFile as string;
    const raw = readTextFromPathOrStdin(filePath);
    const parsed = JSON.parse(raw) as Array<{ role: string; content: string | ContentBlock[] }>;
    for (const m of parsed) {
      if (m.role === 'system') {
        system = typeof m.content === 'string' ? m.content : '';
      } else {
        messages.push(m as ChatMessage);
      }
    }
  }

  // --prompt is an alias for --message
  if (!flags.message && flags.prompt) {
    flags.message = Array.isArray(flags.prompt) ? flags.prompt : [flags.prompt as string];
  }

  if (flags.message) {
    const validRoles = new Set(['system', 'user', 'assistant']);
    const msgs = flags.message as string[];
    for (const m of msgs) {
      const colonIdx = m.indexOf(':');
      const maybeRole = colonIdx !== -1 ? m.slice(0, colonIdx) : '';

      if (validRoles.has(maybeRole)) {
        const content = m.slice(colonIdx + 1);
        if (maybeRole === 'system') {
          system = content;
        } else {
          messages.push({ role: maybeRole as 'user' | 'assistant', content });
        }
      } else {
        // Bare string → user message
        messages.push({ role: 'user', content: m });
      }
    }
  }

  return { system, messages };
}

/**
 * Attach image blocks to the last user message, promoting its content from a
 * bare string to a block array. Images land after the text so the model reads
 * the instruction first.
 */
function attachImages(messages: ChatMessage[], images: ContentBlock[]): void {
  let idx = messages.length - 1;
  while (idx >= 0 && messages[idx]!.role !== 'user') idx--;

  if (idx < 0) {
    messages.push({ role: 'user', content: images });
    return;
  }

  const target = messages[idx]!;
  const content = typeof target.content === 'string'
    ? (target.content ? [{ type: 'text' as const, text: target.content }] : [])
    : target.content;
  target.content = [...content, ...images];
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('');
}

export default defineCommand({
  name: 'text chat',
  description: 'Send a chat completion (MiniMax Messages API)',
  apiDocs: '/docs/api-reference/text-post',
  usage: 'mmx text chat --message <text> [flags]',
  options: [
    { flag: '--model <model>', description: 'Model ID (default: MiniMax-M3)' },
    { flag: '--message <text>',        description: 'Message text (repeatable, prefix role: to set role)', required: true, type: 'array' },
    { flag: '--messages-file <path>',  description: 'JSON file with messages array (use - for stdin)' },
    { flag: '--system <text>',         description: 'System prompt' },
    { flag: '--image <path-or-url>',   description: 'Image to send with the message (repeatable, base64 encoded automatically)', type: 'array' },
    { flag: '--max-tokens <n>',        description: 'Maximum tokens to generate (default: 4096)', type: 'number' },
    { flag: '--temperature <n>',       description: 'Sampling temperature (0.0, 1.0]', type: 'number' },
    { flag: '--top-p <n>',             description: 'Nucleus sampling threshold', type: 'number' },
    { flag: '--stream',                description: 'Stream response tokens (default: on in TTY)' },
    { flag: '--tool <json-or-path>',   description: 'Tool definition as JSON or file path (repeatable)', type: 'array' },
  ],
  examples: [
    'mmx text chat --message "What is MiniMax?"',
    'mmx text chat --model MiniMax-M3 --system "You are a coding assistant." --message "Write fizzbuzz in Python"',
    'mmx text chat --message "Hello" --message "assistant:Hi!" --message "How are you?"',
    'mmx text chat --image photo.jpg --message "What breed is this dog?"',
    'mmx text chat --image before.png --image after.png --message "List every visual difference."',
    'cat conversation.json | mmx text chat --messages-file - --stream',
    'mmx text chat --message "Hello" --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const { system, messages: parsedMessages } = parseMessages(flags);
    let messages = parsedMessages;
    const imageInputs = (flags.image as string[] | undefined) ?? [];

    if (messages.length === 0 && imageInputs.length === 0) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const hint = await promptText({
          message: 'Enter your message:',
        });
        if (!hint) {
          process.stderr.write('Chat cancelled.\n');
          process.exit(1);
        }
        messages = [{ role: 'user', content: hint }];
      } else {
        failIfMissing('message', 'mmx text chat --message <text>');
      }
    }

    if (imageInputs.length > 0) {
      const images: ContentBlock[] = [];
      // Track the running request-body size so a run bails as soon as it's
      // clear the request would exceed the cap, not after every image is
      // fetched and encoded.
      let requestBytes = Buffer.byteLength(JSON.stringify(messages), 'utf-8')
        + Buffer.byteLength(system ?? '', 'utf-8');

      for (const input of imageInputs) {
        const block = await toImageBlock(input, {
          maxBytes: CHAT_IMAGE_MAX_BYTES,
          allowedMediaTypes: CHAT_IMAGE_ALLOWED_TYPES,
        });
        requestBytes += block.source.data.length;
        if (requestBytes > CHAT_MAX_REQUEST_BYTES) {
          throw new CLIError(
            `Request body exceeds the ${CHAT_MAX_REQUEST_BYTES / 1024 / 1024} MB limit once this image is attached.`,
            ExitCode.USAGE,
            'Send fewer or smaller --image inputs.',
          );
        }
        images.push(block);
      }

      attachImages(messages, images);
    }

    // Images require a multimodal model, so they override a text-only config default.
    const model = (flags.model as string)
      || (imageInputs.length > 0 ? 'MiniMax-M3' : config.defaultTextModel)
      || 'MiniMax-M3';
    const format = detectOutputFormat(config.output);
    const shouldStream = flags.stream === true || (
      flags.stream === undefined
      && format !== 'json'
      && process.stdout.isTTY
    );

    const body: ChatRequest = {
      model,
      messages,
      max_tokens: (flags.maxTokens as number) ?? 4096,
      stream: shouldStream,
    };

    if (system) body.system = system;
    if (flags.temperature !== undefined) body.temperature = flags.temperature as number;
    if (flags.topP !== undefined) body.top_p = flags.topP as number;

    if (flags.tool) {
      const tools = (flags.tool as string[]).map(t => {
        try {
          return JSON.parse(t);
        } catch {
          // Not JSON — treat as file path
          try {
            const raw = readFileSync(t, 'utf-8');
            return JSON.parse(raw);
          } catch {
            throw new CLIError(
              `Invalid tool definition: "${t}" is neither valid JSON nor a readable file.`,
              ExitCode.USAGE,
            );
          }
        }
      });
      body.tools = tools;
    }

    if (config.dryRun) {
      console.log(formatOutput({ request: body }, format));
      return;
    }

    const url = chatEndpoint(config.baseUrl);

    if (shouldStream) {
      const res = await request(config, {
        url,
        method: 'POST',
        body,
        stream: true,
        authStyle: 'x-api-key',
      });

      // Validate response is actually SSE before attempting to parse
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') && !contentType.includes('stream')) {
        throw new CLIError(
          `Expected SSE stream but got content-type "${contentType}". Server may be experiencing issues.`,
          ExitCode.GENERAL,
        );
      }

      let textContent = '';
      let inThinking = false;
      const dim = config.noColor ? '' : '\x1b[2m';
      const reset = config.noColor ? '' : '\x1b[0m';
      const isJsonOutput = format === 'json';
      const isTTY = process.stdout.isTTY;
      const statusOut = isTTY && !isJsonOutput ? process.stderr : process.stderr;
      const resultOut = isJsonOutput ? undefined : process.stdout;

      const think = new ThinkingIndicator(statusOut, config.noColor);

      for await (const event of parseSSE(res)) {
        if (event.data === '[DONE]') break;
        try {
          const parsed = JSON.parse(event.data) as StreamEvent;

          if (parsed.type === 'content_block_start') {
            if (parsed.content_block.type === 'thinking') {
              inThinking = true;
              think.start();
            } else if (parsed.content_block.type === 'text' && inThinking) {
              think.stop();
              inThinking = false;
              statusOut.write(`${reset}\nResponse:\n`);
            }
          } else if (parsed.type === 'content_block_delta') {
            if (parsed.delta.type === 'text_delta') {
              textContent += parsed.delta.text;
              resultOut?.write(parsed.delta.text);
            }
            // thinking_delta is intentionally ignored — the dynamic
            // spinner conveys activity without dumping raw thought text.
          }
        } catch (err) {
          // Warn but don't crash — partial output is better than nothing
          process.stderr.write(`\n${dim}[warning] Failed to parse stream chunk: ${err instanceof Error ? err.message : String(err)}${reset}\n`);
        }
      }
      if (inThinking) think.stop();

      if (format === 'json') {
        console.log(formatOutput({ content: textContent }, format));
      } else {
        resultOut?.write('\n');
      }
    } else {
      const response = await requestJson<ChatResponse>(config, {
        url,
        method: 'POST',
        body,
        authStyle: 'x-api-key',
      });

      const text = extractText(response.content);

      if (config.quiet || format === 'text') {
        console.log(text);
      } else {
        console.log(formatOutput(response, format));
      }
    }
  },
});
