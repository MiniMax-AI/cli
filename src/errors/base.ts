import { ExitCode } from './codes';

export class CLIError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, exitCode: ExitCode = ExitCode.GENERAL, hint?: string) {
    super(message);
    this.name = 'CLIError';
    this.exitCode = exitCode;
    this.hint = hint;
  }

  toJSON() {
    return {
      error: {
        code: this.exitCode,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

export class SDKError extends CLIError {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, exitCode: ExitCode = ExitCode.GENERAL, hint?: string) {
    super(message);
    this.name = 'SDKError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}
