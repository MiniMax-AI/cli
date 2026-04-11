import { defineCommand } from '../../command';
import { request, requestJson } from '../../client/http';
import { chatEndpoint } from '../../client/endpoints';
import { parseSSE } from '../../client/stream';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
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
import { promptText, failIfMissing } from '../../utils/prompt';

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
    const raw = filePath === '-'
      ? readFileSync('/dev/stdin', 'utf-8')
      : readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Array<{ role: string; content: string | ContentBlock[] }>;
    for (const m of parsed) {
      if (m.role === 'system') {
        system = typeof m.content === 'string' ? m.content : '';
      } else {
        messages.push(m as ChatMessage);
      }
    }
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
    { flag: '--model <model>', description: 'Model ID (default: MiniMax-M2.7)' },
    { flag: '--message <text>',        description: 'Message text (repeatable, prefix role: to set role)', required: true, type: 'array' },
    { flag: '--messages-file <path>',  description: 'JSON file with messages array (use - for stdin)' },
    { flag: '--system <text>',         description: 'System prompt' },
    { flag: '--max-tokens <n>',        description: 'Maximum tokens to generate (default: 4096)', type: 'number' },
    { flag: '--temperature <n>',       description: 'Sampling temperature (0.0, 1.0]', type: 'number' },
    { flag: '--top-p <n>',             description: 'Nucleus sampling threshold', type: 'number' },
    { flag: '--stream',                description: 'Stream response tokens (default: on in TTY)' },
    { flag: '--tool <json-or-path>',   description: 'Tool definition as JSON or file path (repeatable)', type: 'array' },
  ],
  examples: [
    'mmx text chat --message "What is MiniMax?"',
    'mmx text chat --model MiniMax-M2.7-highspeed --system "You are a coding assistant." --message "Write fizzbuzz in Python"',
    'mmx text chat --message "Hello" --message "assistant:Hi!" --message "How are you?"',
    'cat conversation.json | mmx text chat --messages-file - --stream',
    'mmx text chat --message "Hello" --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const { system, messages: parsedMessages } = parseMessages(flags);
    let messages = parsedMessages;

    if (messages.length === 0) {
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

    const model = (flags.model as string)
      || config.defaultTextModel
      || 'MiniMax-M2.7';
    const shouldStream = flags.stream === true || (flags.stream === undefined && process.stdout.isTTY);
    const format = detectOutputFormat(config.output);

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
          const raw = readFileSync(t, 'utf-8');
          return JSON.parse(raw);
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

      let textContent = '';
      let inThinking = false;
      const dim = config.noColor ? '' : '\x1b[2m';
      const reset = config.noColor ? '' : '\x1b[0m';
      const isTTY = process.stdout.isTTY;
      // In TTY mode, write thinking/response headers to stdout for display.
      // In non-TTY (pipe/agent) mode, write everything but final text to stderr.
      const statusOut = isTTY ? process.stdout : process.stderr;
      const resultOut = process.stdout;

      for await (const event of parseSSE(res)) {
        if (event.data === '[DONE]') break;
        try {
          const parsed = JSON.parse(event.data) as StreamEvent;

          if (parsed.type === 'content_block_start') {
            if (parsed.content_block.type === 'thinking') {
              inThinking = true;
              statusOut.write(`${dim}Thinking:\n`);
            } else if (parsed.content_block.type === 'text' && inThinking) {
              statusOut.write(`${reset}\n\nResponse:\n`);
              inThinking = false;
            }
          } else if (parsed.type === 'content_block_delta') {
            if (parsed.delta.type === 'text_delta') {
              textContent += parsed.delta.text;
              resultOut.write(parsed.delta.text);
            } else if (parsed.delta.type === 'thinking_delta') {
              statusOut.write(parsed.delta.thinking);
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      }
      if (inThinking) statusOut.write(reset);
      resultOut.write('\n');

      if (format === 'json') {
        console.log(formatOutput({ content: textContent }, format));
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
