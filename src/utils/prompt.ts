/**
 * Interactive prompt utilities.
 *
 * Wraps @clack/prompts with environment-awareness:
 * - In interactive mode: shows prompts and lets users input values.
 * - In non-interactive / CI / Agent mode: fails fast with a clear error.
 *
 * All functions here are no-ops (return undefined) when non-interactive,
 * so callers must check isInteractive() first or handle the missing-value
 * case explicitly.
 */

import { PasswordPrompt } from '@clack/core';

import { isInteractive } from './env.js';
import { CLIError } from '../errors/base.js';
import { ExitCode } from '../errors/codes';

// Dynamic import to avoid loading @clack/prompts in non-interactive envs unnecessarily
// (though for CLI tools the startup cost is usually acceptable)

/**
 * Prompt the user for a text value.
 * Only call this when isInteractive() is true; otherwise the function returns
 * undefined immediately so the caller can fail fast.
 */
export async function promptText(options: {
  message: string;
  defaultValue?: string;
}): Promise<string | undefined> {
  if (!isInteractive()) return undefined;

  const { defaultValue, message } = options;
  const inquirer = await import('@clack/prompts');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const val = await (inquirer as any).text({
    message,
    default: defaultValue,
    placeholder: defaultValue,
  });

  // @clack/prompts returns a Symbol.cancel when the user presses Ctrl+C
  if (typeof val === 'symbol') return undefined;
  return val as string;
}

/**
 * Like promptText but confirms with y/N before proceeding.
 */
export async function promptConfirm(options: {
  message: string;
}): Promise<boolean | undefined> {
  if (!isInteractive()) return undefined;

  const { message } = options;
  const inquirer = await import('@clack/prompts');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const val = await (inquirer as any).confirm({ message });

  if (typeof val === 'symbol') return undefined;
  return val as boolean;
}

const PASSWORD_MASK_PREVIEW_LENGTH = 12;
const PROMPT_THEME = '\x1b[38;2;248;103;58m'; // #F8673A
const RESET_COLOR = '\x1b[0m';

function themed(value: string): string {
  return process.env.NO_COLOR ? value : `${PROMPT_THEME}${value}${RESET_COLOR}`;
}

export function passwordMaskPreview(length: number): string {
  const mask = '•'.repeat(Math.min(length, PASSWORD_MASK_PREVIEW_LENGTH));
  return length > PASSWORD_MASK_PREVIEW_LENGTH ? `${mask}… (${length} chars)` : mask;
}

export async function promptPassword(options: { message: string }): Promise<string | undefined> {
  if (!isInteractive()) return undefined;

  const val = await new PasswordPrompt({
    mask: '•',
    render() {
      const length = typeof this.value === 'string' ? this.value.length : 0;
      const preview = passwordMaskPreview(length);
      if (this.state === 'submit') {
        return `${themed('│')}\n${themed('◇')}  ${options.message}\n${themed('│')}  ${preview}`;
      }
      if (this.state === 'cancel') return `${themed('│')}\n■  ${options.message}\n│  Cancelled`;
      return `${themed('│')}\n${themed('◆')}  ${options.message}\n`
        + `${themed('│')}  ${preview}${themed('_')}\n${themed('└')}`;
    },
  }).prompt();
  if (typeof val === 'symbol') return undefined;
  return val;
}

export async function promptSelect(options: {
  message: string;
  choices: Array<{ value: string; label: string; hint?: string }>;
  initialValue?: string;
}): Promise<string | undefined> {
  if (!isInteractive()) return undefined;

  const inquirer = await import('@clack/prompts');
  const val = await inquirer.select({
    message: options.message,
    options: options.choices,
    initialValue: options.initialValue,
  });
  if (typeof val === 'symbol') return undefined;
  return val as string;
}

export async function promptMultiSelect(options: {
  message: string;
  choices: Array<{ value: string; label: string; hint?: string }>;
  initialValues?: string[];
  required?: boolean;
}): Promise<string[] | undefined> {
  if (!isInteractive()) return undefined;

  const inquirer = await import('@clack/prompts');
  const val = await inquirer.multiselect({
    message: options.message,
    options: options.choices,
    initialValues: options.initialValues,
    required: options.required,
  });
  if (typeof val === 'symbol') return undefined;
  return val as string[];
}

/**
 * Fail fast with a user-friendly error when a required option is missing
 * in non-interactive (agent / CI) mode.
 */
export function failIfMissing(flagName: string, context: string): never {
  throw new CLIError(
    `Missing required argument: --${flagName}\n` +
    `Hint: In non-interactive (CI / agent) environments all required flags must be provided.\n` +
    `      In an interactive terminal, run without --${flagName} and the CLI will prompt for it.`,
    ExitCode.USAGE,
    context,
  );
}

export async function promptOrFail(opts: {
  value: string | undefined;
  message: string;
  cancelMessage: string;
  flagName: string;
  usageHint: string;
  nonInteractive?: boolean;
}): Promise<string> {
  if (opts.value) return opts.value;

  if (isInteractive({ nonInteractive: opts.nonInteractive })) {
    const hint = await promptText({ message: opts.message });
    if (!hint) {
      process.stderr.write(opts.cancelMessage + '\n');
      process.exit(1);
    }
    return hint;
  }

  failIfMissing(opts.flagName, opts.usageHint);
}
