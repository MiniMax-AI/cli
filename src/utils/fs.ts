import { readFileSync } from 'fs';

export function resolveTextInput(path: string): string | number {
  // File descriptor 0 is stdin on every platform supported by Node. `/dev/stdin`
  // only exists on POSIX systems, so using it breaks `--*-file -` on Windows.
  return path === '-' ? 0 : path;
}

export function readTextFromPathOrStdin(path: string): string {
  return readFileSync(resolveTextInput(path), 'utf-8');
}
