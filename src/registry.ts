import type { Command } from './command';
import { CLIError } from './errors/base';
import { ExitCode } from './errors/codes';
import { DOCS_HOSTS, type Region } from './config/schema';

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
import musicCover from './commands/music/cover';
import searchQuery from './commands/search/query';
import visionDescribe from './commands/vision/describe';
import quotaShow from './commands/quota/show';
import configShow from './commands/config/show';
import configSet from './commands/config/set';
import configExportSchema from './commands/config/export-schema';
import update from './commands/update';
import help from './commands/help';

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

    // Single child: auto-forward (e.g. `mmx quota` → `mmx quota show`)
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
        `Unknown command: mmx ${commandPath.join(' ')}\n\nAvailable commands:\n${subcommands}`,
        ExitCode.USAGE,
        `mmx ${matched.join(' ')} --help`,
      );
    }

    throw new CLIError(
      `Unknown command: mmx ${commandPath.join(' ')}`,
      ExitCode.USAGE,
      'mmx --help',
    );
  }

  /**
   * Print help to the given output stream.
   * Defaults to stdout; pass stderr (or a non-TTY stream) to keep stdout
   * clean for piped / JSON output.
   */
  // Color helpers — no-ops when output is not a TTY
  private bold  = (s: string, out: NodeJS.WriteStream) => out.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
  private accent = (s: string, out: NodeJS.WriteStream) => out.isTTY ? `\x1b[38;2;248;103;58m${s}\x1b[0m` : s;
  private dim   = (s: string, out: NodeJS.WriteStream) => out.isTTY ? `\x1b[2m${s}\x1b[0m` : s;

  printHelp(commandPath: string[], out: NodeJS.WriteStream = process.stdout, region: Region = 'global'): void {
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
      this.printCommandHelp(node.command, out, region);
      return;
    }

    // Group help (e.g. `mmx auth --help`)
    const prefix = commandPath.join(' ');
    out.write(`\n${this.bold('Usage:', out)} mmx ${prefix} <command> [flags]\n\n`);
    out.write(`${this.bold('Commands:', out)}\n`);
    this.printChildren(node, prefix, out);
    out.write('\n');
  }

  private printRootHelp(out: NodeJS.WriteStream): void {
    // MiniMax brand gradient: #F0177A (pink) → #FA7B2A (orange), one color per row
    const LOGO = [
      '███╗   ███╗███╗   ███╗██╗  ██╗',
      '████╗ ████║████╗ ████║╚██╗██╔╝',
      '██╔████╔██║██╔████╔██║ ╚███╔╝ ',
      '██║╚██╔╝██║██║╚██╔╝██║ ██╔██╗ ',
      '██║ ╚═╝ ██║██║ ╚═╝ ██║██╔╝ ██╗',
      '╚═╝     ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝',
    ];
    const GRADIENT: [number, number, number][] = [
      [240,  23, 122],
      [242,  43, 106],
      [244,  63,  90],
      [246,  83,  74],
      [248, 103,  58],
      [250, 123,  42],
    ];

    out.write('\n');
    for (let i = 0; i < LOGO.length; i++) {
      if (out.isTTY) {
        const [r, g, b] = GRADIENT[i];
        out.write(`\x1b[1;38;2;${r};${g};${b}m${LOGO[i]}\x1b[0m\n`);
      } else {
        out.write(LOGO[i] + '\n');
      }
    }

    const b = (s: string) => this.bold(s, out);
    const a = (s: string) => this.accent(s, out);
    const d = (s: string) => this.dim(s, out);

    out.write(`
${b('Usage:')} mmx <resource> <command> [flags]

${b('Resources:')}
  ${a('auth')}       ${d('Authentication (login, status, refresh, logout)')}
  ${a('text')}       ${d('Text generation (chat)')}
  ${a('speech')}     ${d('Speech synthesis (synthesize, voices)')}
  ${a('image')}      ${d('Image generation (generate)')}
  ${a('video')}      ${d('Video generation (generate, task get, download)')}
  ${a('music')}      ${d('Music generation (generate, cover)')}
  ${a('search')}     ${d('Web search (query)')}
  ${a('vision')}     ${d('Image understanding (describe)')}
  ${a('quota')}      ${d('Usage quotas (show)')}
  ${a('config')}     ${d('CLI configuration (show, set, export-schema)')}
  ${a('update')}     ${d('Update mmx to a newer version')}

${b('Global Flags:')}
  ${a('--api-key <key>')}        ${d('API key (overrides all other auth)')}
  ${a('--region <region>')}      ${d('API region: global (default), cn')}
  ${a('--base-url <url>')}       ${d('API base URL (overrides region)')}
  ${a('--output <format>')}      ${d('Output format: text, json')}
  ${a('--quiet')}                ${d('Suppress non-essential output')}
  ${a('--verbose')}              ${d('Print HTTP request/response details')}
  ${a('--timeout <seconds>')}    ${d('Request timeout (default: 300)')}
  ${a('--no-color')}             ${d('Disable ANSI colors and spinners')}
  ${a('--dry-run')}              ${d('Show what would happen without executing')}
  ${a('--non-interactive')}      ${d('Disable interactive prompts (CI/agent mode)')}
  ${a('--version')}              ${d('Print version and exit')}
  ${a('--help')}                 ${d('Show help')}

${b('Getting Help:')}
  ${d('Add --help after any command to see its full list of options, defaults,')}
  ${d('and usage examples. For example:')} mmx text chat --help
`);
  }

  private printCommandHelp(cmd: Command, out: NodeJS.WriteStream, region: Region = 'global'): void {
    const b = (s: string) => this.bold(s, out);
    const a = (s: string) => this.accent(s, out);
    const d = (s: string) => this.dim(s, out);

    out.write(`\n${cmd.description}\n`);
    if (cmd.usage) out.write(`${b('Usage:')} ${cmd.usage}\n`);
    if (cmd.options && cmd.options.length > 0) {
      const maxLen = Math.max(...cmd.options.map(o => o.flag.length));
      out.write(`\n${b('Options:')}\n`);
      for (const opt of cmd.options) {
        out.write(`  ${a(opt.flag.padEnd(maxLen + 2))} ${d(opt.description)}\n`);
      }
    }
    if (cmd.examples && cmd.examples.length > 0) {
      out.write(`\n${b('Examples:')}\n`);
      for (const ex of cmd.examples) {
        out.write(`  ${d(ex)}\n`);
      }
    }
    if (cmd.apiDocs) {
      out.write(`\n${b('API Reference:')} ${d(DOCS_HOSTS[region] + cmd.apiDocs)}\n`);
    }
    out.write(`\n${d('Global flags (--api-key, --output, --quiet, etc.) are always available.')}\n`);
    out.write(`${d("Run")} mmx --help ${d('for the full list.')}\n`);
  }

  private printChildren(node: CommandNode, prefix: string, out: NodeJS.WriteStream): void {
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
      out.write(`  ${this.accent(fullName.padEnd(maxLen), out)}  ${this.dim(description, out)}\n`);
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
  'speech generate':   speechSynthesize,
  'speech voices':     speechVoices,
  'image generate':    imageGenerate,
  'video generate':    videoGenerate,
  'video task get':    videoTaskGet,
  'video download':    videoDownload,
  'music generate':    musicGenerate,
  'music cover':       musicCover,
  'search query':      searchQuery,
  'search web':        searchQuery,
  'vision describe':   visionDescribe,
  'quota show':       quotaShow,
  'config show':          configShow,
  'config set':           configSet,
  'config export-schema': configExportSchema,
  'update':               update,
  'help':                 help,
});
