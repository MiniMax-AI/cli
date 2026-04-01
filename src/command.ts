import type { Config } from './config/schema';
import type { GlobalFlags } from './types/flags';

export interface OptionDef {
  flag: string;
  description: string;
  type?: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  options?: OptionDef[];
  examples?: string[];
  execute(config: Config, flags: GlobalFlags): Promise<void>;
}

export interface CommandSpec {
  name: string;
  description: string;
  usage?: string;
  options?: OptionDef[];
  examples?: string[];
  run(config: Config, flags: GlobalFlags): Promise<void>;
}

export function defineCommand(spec: CommandSpec): Command {
  return {
    name: spec.name,
    description: spec.description,
    usage: spec.usage,
    options: spec.options,
    examples: spec.examples,
    execute: spec.run,
  };
}

/** Global flags shared by all commands — drives the parser's type resolution. */
export const GLOBAL_OPTIONS: OptionDef[] = [
  { flag: '--api-key <key>',     description: 'API key' },
  { flag: '--region <region>',   description: 'API region: global, cn' },
  { flag: '--base-url <url>',    description: 'API base URL' },
  { flag: '--output <format>',   description: 'Output format: text, json' },
  { flag: '--timeout <seconds>', description: 'Request timeout', type: 'number' },
  { flag: '--quiet',             description: 'Suppress non-essential output' },
  { flag: '--verbose',           description: 'Print HTTP request/response details' },
  { flag: '--no-color',          description: 'Disable ANSI colors' },
  { flag: '--dry-run',           description: 'Dry run mode' },
  { flag: '--non-interactive',   description: 'Disable interactive prompts' },
  { flag: '--help',              description: 'Show help' },
  { flag: '--version',           description: 'Print version' },
];
