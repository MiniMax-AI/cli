import { readFileSync } from 'fs';

export function readTextFromPathOrStdin(path: string): string {
  return readFileSync(path === '-' ? '/dev/stdin' : path, 'utf-8');
}
