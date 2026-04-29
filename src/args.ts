import type { GlobalFlags } from './types/flags';
import type { OptionDef } from './command';

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Extract camelCase flag name from an OptionDef.flag string, e.g. '--max-tokens <n>' → 'maxTokens' */
function flagKey(def: OptionDef): string | null {
  const m = def.flag.match(/^--([a-z][a-z0-9-]*)/i);
  return m ? kebabToCamel(m[1]!) : null;
}

/** Boolean when no value placeholder and type is not string/number/array */
function isBooleanDef(def: OptionDef): boolean {
  if (def.type === 'boolean') return true;
  if (def.type === 'string' || def.type === 'number' || def.type === 'array') return false;
  return !def.flag.includes('<') && !def.flag.includes('[');
}

interface FlagSchema {
  booleans: Set<string>;
  numbers: Set<string>;
  arrays: Set<string>;
}

function buildSchema(options: OptionDef[]): FlagSchema {
  const booleans = new Set<string>();
  const numbers = new Set<string>();
  const arrays = new Set<string>();
  for (const opt of options) {
    const key = flagKey(opt);
    if (!key) continue;
    if (isBooleanDef(opt)) booleans.add(key);
    else if (opt.type === 'number') numbers.add(key);
    else if (opt.type === 'array') arrays.add(key);
  }
  return { booleans, numbers, arrays };
}

/**
 * Quick scan: collect positional (non-dash) args to determine the command path.
 * Skips global flags and their values so that e.g. `--output json text chat`
 * correctly produces ['text', 'chat'] instead of ['json', 'text', 'chat'].
 */
export function scanCommandPath(argv: string[], globalOptions: OptionDef[] = []): string[] {
  const globalSchema = buildSchema(globalOptions);
  const path: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--') break;

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      const key = eqIdx !== -1 ? arg.slice(2, eqIdx) : arg.slice(2);
      const camelKey = kebabToCamel(key);

      if (!globalSchema.booleans.has(camelKey) && eqIdx === -1) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('-')) { i++; continue; }

    path.push(arg);
    i++;
  }
  return path;
}

/**
 * Full flag parse. Types are derived entirely from the provided OptionDef schema:
 *   - boolean: no <value> placeholder in flag string (or type: 'boolean')
 *   - number:  type: 'number'
 *   - array:   type: 'array'  (repeatable via multiple --flag occurrences)
 *   - default: string
 */
export function parseFlags(argv: string[], options: OptionDef[]): GlobalFlags {
  const schema = buildSchema(options);
  const flags: GlobalFlags = {
    quiet: false,
    verbose: false,
    noColor: false,
    yes: false,
    dryRun: false,
    help: false,
    nonInteractive: false,
    async: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === '--help' || arg === '-h') { flags.help = true; i++; continue; }
    if (arg === '--') { break; }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      let key: string;
      let value: string | undefined;

      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        value = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
      }

      const camelKey = kebabToCamel(key);

      if (schema.booleans.has(camelKey)) {
        (flags as Record<string, unknown>)[camelKey] = true;
        i++;
        continue;
      }

      if (value === undefined) {
        i++;
        value = argv[i];
      }

      if (value === undefined) throw new Error(`Flag --${key} requires a value.`);

      if (schema.arrays.has(camelKey)) {
        const arr = (flags as Record<string, unknown>)[camelKey] as string[] | undefined;
        if (arr) arr.push(value);
        else (flags as Record<string, unknown>)[camelKey] = [value];
      } else if (schema.numbers.has(camelKey)) {
        const numericValue = Number(value);
        if (value.trim() === '' || !Number.isFinite(numericValue)) {
          throw new Error(`Flag --${key} requires a numeric value, got "${value}".`);
        }
        (flags as Record<string, unknown>)[camelKey] = numericValue;
      } else {
        (flags as Record<string, unknown>)[camelKey] = value;
      }
    }

    i++;
  }

  return flags;
}
