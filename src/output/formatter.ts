import { formatText } from './text';
import { formatJson } from './json';

export type OutputFormat = 'text' | 'json';

export function detectOutputFormat(flagValue?: string): OutputFormat {
  if (flagValue === 'json' || flagValue === 'text') {
    return flagValue;
  }
  if (!process.stdout.isTTY) {
    return 'json';
  }
  return 'text';
}

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return formatJson(data);
    case 'text':
      return formatText(data);
  }
}
