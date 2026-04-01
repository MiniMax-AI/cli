import type { Command } from './command';
import { CLIError } from './errors/base';
import { ExitCode } from './errors/codes';

import authLogin from './commands/auth/login';
import authStatus from './commands/auth/status';
import authRefresh from './commands/auth/refresh';
import authLogout from './commands/auth/logout';
import textChat from './commands/text/chat';
import speechSynthesize from './commands/speech/synthesize';
import speechVoices from './commands/speech/voices';
import imageGenerate from './commands/image/generate';
import videoGenerate from './commands/video/generate';
import videoTaskGet from './commands/video/task-get';
import videoDownload from './commands/video/download';
import musicGenerate from './commands/music/generate';
import searchQuery from './commands/search/query';
import visionDescribe from './commands/vision/describe';
import quotaShow from './commands/quota/show';
import configShow from './commands/config/show';
import configSet from './commands/config/set';
import configExportSchema from './commands/config/export-schema';
import update from './commands/update';

export type { Command, OptionDef } from './command';

interface CommandNode {
  command?: Command;
  children: Map<string, CommandNode>;
}

class CommandRegistry {
  private root: CommandNode = { children: new Map() };

  constructor(commands: Record<string, Command>) {
    for (const [path, cmd] of Object.entries(commands)) {
      this.register(path, cmd);
    }
  }

  private register(path: string, command: Command): void {
    const parts = path.split(' ');
    let node = this.root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map() });
      }
      node = node.children.get(part)!;
    }
    node.command = command;
  }

  getAllCommands(): Command[] {
    const commands: Command[] = [];
    const traverse = (node: CommandNode) => {
      if (node.command) commands.push(node.command);
      for (const child of node.children.values()) {
        traverse(child);
      }
    };
    traverse(this.root);
    return commands;
  }

  resolve(commandPath: string[]): { command: Command; extra: string[] } {
    let node = this.root;
    const matched: string[] = [];

    for (const part of commandPath) {
      const child = node.children.get(part);
      if (!child) break;
      node = child;
      matched.push(part);
    }

    if (node.command) {
      return { command: node.command, extra: commandPath.slice(matched.length) };
    }

    // Single child: auto-forward (e.g. `minimax quota` → `minimax quota show`)
    if (matched.length > 0 && node.children.size === 1) {
      const [, child] = node.children.entries().next().value as [string, CommandNode];
      if (child.command) {
        return { command: child.command, extra: commandPath.slice(matched.length) };
      }
    }

    // If we matched some path but no command, show help for that group
    if (matched.length > 0 && node.children.size > 0) {
      const subcommands = Array.from(node.children.entries())
        .map(([name, n]) => {
          if (n.command) return `  ${matched.join(' ')} ${name}    ${n.command.description}`;
          const subs = Array.from(n.children.keys()).join(', ');
          return `  ${matched.join(' ')} ${name} [${subs}]`;
        })
        .join('\n');
      throw new CLIError(
        `Unknown command: minimax ${commandPath.join(' ')}\n\nAvailable commands:\n${subcommands}`,
        ExitCode.USAGE,
        `minimax ${matched.join(' ')} --help`,
      );
    }

    throw new CLIError(
      `Unknown command: minimax ${commandPath.join(' ')}`,
      ExitCode.USAGE,
      'minimax --help',
    );
  }

  /**
   * Print help to the given output stream.
   * Defaults to stdout; pass stderr (or a non-TTY stream) to keep stdout
   * clean for piped / JSON output.
   */
  printHelp(commandPath: string[], out: NodeJS.WriteStream = process.stdout): void {
    if (commandPath.length === 0) {
      this.printRootHelp(out);
      return;
    }

    let node = this.root;
    for (const part of commandPath) {
      const child = node.children.get(part);
      if (!child) {
        this.printRootHelp(out);
        return;
      }
      node = child;
    }

    if (node.command) {
      this.printCommandHelp(node.command, out);
      return;
    }

    // Group help
    out.write(`\nUsage: minimax ${commandPath.join(' ')} <command> [flags]\n\n`);
    out.write('Commands:\n');
    this.printChildren(node, commandPath.join(' '), out);
    out.write('\n');
  }

  private printRootHelp(out: NodeJS.WriteStream): void {
    out.write(`
  __  __ ___ _   _ ___ __  __    _   __  __
 |  \\/  |_ _| \\ | |_ _|  \\/  |  / \\ \\ \\/ /
 | |\\/| || ||  \\| || || |\\/| | / _ \\ \\  /
 | |  | || || |\\  || || |  | |/ ___ \\/  \\
 |_|  |_|___|_| \\_|___|_|  |_/_/   \\_\\_/\\

Usage: minimax <resource> <command> [flags]

Resources:
  auth       Authentication (login, status, refresh, logout)
  text       Text generation (chat)
  speech     Speech synthesis (synthesize, voices)
  image      Image generation (generate)
  video      Video generation (generate, task get, download)
  music      Music generation (generate)
  search     Web search (query)
  vision     Image understanding (describe)
  quota      Usage quotas (show)
  config     CLI configuration (show, set, export-schema)
  update     Update minimax to a newer version

Global Flags:
  --api-key <key>        API key (overrides all other auth)
  --region <region>      API region: global (default), cn
  --base-url <url>       API base URL (overrides region)
  --output <format>      Output format: text, json
  --quiet                Suppress non-essential output
  --verbose              Print HTTP request/response details
  --timeout <seconds>    Request timeout (default: 300)
  --no-color             Disable ANSI colors and spinners
  --dry-run              Show what would happen without executing
  --non-interactive      Disable interactive prompts (CI/agent mode)
  --version              Print version and exit
  --help                 Show help

Getting Help:
  Add --help after any command to see its full list of options, defaults,
  and usage examples. For example: minimax text chat --help
`);
  }

  private printCommandHelp(cmd: Command, out: NodeJS.WriteStream): void {
    out.write(`\n${cmd.description}\n`);
    if (cmd.usage) out.write(`Usage: ${cmd.usage}\n`);
    if (cmd.options && cmd.options.length > 0) {
      const maxLen = Math.max(...cmd.options.map(o => o.flag.length));
      out.write('Options:\n');
      for (const opt of cmd.options) {
        out.write(`  ${opt.flag.padEnd(maxLen + 2)} ${opt.description}\n`);
      }
      out.write('\n');
    }
    if (cmd.examples && cmd.examples.length > 0) {
      out.write('Examples:\n');
      for (const ex of cmd.examples) {
        out.write(`  ${ex}\n`);
      }
      out.write('\n');
    }
    out.write(`Global flags (--api-key, --output, --quiet, etc.) are always available.\n`);
    out.write(`Run 'minimax --help' for the full list.\n`);
  }

  private printChildren(node: CommandNode, prefix: string, out: NodeJS.WriteStream): void {
    // Collect all leaf entries first so we can align the description column.
    const entries: Array<{ fullName: string; description: string }> = [];
    const collect = (n: CommandNode, p: string) => {
      for (const [name, child] of n.children) {
        if (child.command) entries.push({ fullName: `${p} ${name}`, description: child.command.description });
        if (child.children.size > 0) collect(child, `${p} ${name}`);
      }
    };
    collect(node, prefix);
    const maxLen = Math.max(...entries.map(e => e.fullName.length));
    for (const { fullName, description } of entries) {
      out.write(`  ${fullName.padEnd(maxLen)}  ${description}\n`);
    }
  }
}

export const registry = new CommandRegistry({
  'auth login':        authLogin,
  'auth status':       authStatus,
  'auth refresh':      authRefresh,
  'auth logout':       authLogout,
  'text chat':         textChat,
  'speech synthesize': speechSynthesize,
  'speech voices':     speechVoices,
  'image generate':    imageGenerate,
  'video generate':    videoGenerate,
  'video task get':    videoTaskGet,
  'video download':    videoDownload,
  'music generate':    musicGenerate,
  'search query':      searchQuery,
  'vision describe':   visionDescribe,
  'quota show':       quotaShow,
  'config show':          configShow,
  'config set':           configSet,
  'config export-schema': configExportSchema,
  'update':               update,
});
