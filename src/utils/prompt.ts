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

import colors from 'picocolors';

import { CLIError } from '../errors/base.js';
import { ExitCode } from '../errors/codes';
import { isInteractive } from './env.js';

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

const API_KEY_VISIBLE_LENGTH = 30;

export function apiKeyPreview(value: string): string {
  const visible = value.slice(0, API_KEY_VISIBLE_LENGTH);
  const ellipsis = value.length > API_KEY_VISIBLE_LENGTH ? '....' : '';
  return `${visible}${ellipsis} (${value.length} chars)`;
}

export async function promptApiKey(options: { message: string }): Promise<string | undefined> {
  if (!isInteractive()) return undefined;

  const { TextPrompt } = await import('@clack/core');
  const val = await new TextPrompt({
    render() {
      const preview = apiKeyPreview(this.userInput);
      const cursor = colors.inverse(colors.hidden('_'));
      const leadingBar = colors.gray('│');
      switch (this.state) {
        case 'submit':
          return `${leadingBar}\n${colors.green('◇')}  ${options.message}\n`
            + `${leadingBar}  ${colors.dim(preview)}`;
        case 'cancel':
          return `${leadingBar}\n${colors.red('■')}  ${options.message}\n`
            + `${leadingBar}  ${colors.strikethrough(colors.dim(preview))}`;
        case 'error':
          return `${leadingBar}\n${colors.yellow('▲')}  ${options.message}\n`
            + `${colors.yellow('│')}  ${preview}${cursor}\n`
            + `${colors.yellow('└')}  ${colors.yellow(this.error)}`;
        default:
          return `${leadingBar}\n${colors.cyan('◆')}  ${options.message}\n`
            + `${colors.cyan('│')}  ${preview}${cursor}\n${colors.cyan('└')}`;
      }
    },
  }).prompt();

  if (typeof val === 'symbol') return undefined;
  return val;
}

export async function withPromptSpinner<T>(options: {
  message: string;
  successMessage: string;
  errorMessage: string;
}, task: () => Promise<T>): Promise<T> {
  if (!isInteractive()) return task();

  const { spinner } = await import('@clack/prompts');
  const indicator = spinner();
  indicator.start(options.message);
  try {
    const result = await task();
    indicator.stop(options.successMessage);
    return result;
  } catch (error) {
    indicator.error(options.errorMessage);
    throw error;
  }
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

export async function promptNote(options: {
  message: string;
  title?: string;
}): Promise<void> {
  if (!isInteractive()) return;

  const inquirer = await import('@clack/prompts');
  inquirer.note(options.message, options.title);
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
