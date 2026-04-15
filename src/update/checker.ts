import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config/paths';
import { proxyFetch } from '../client/proxy';

const STATE_FILE = () => join(getConfigDir(), 'update-state.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 3000;
const REPO = 'MiniMax-AI-Dev/minimax-cli';

interface UpdateState {
  lastChecked: number;
  latestVersion: string;
}

function readState(): UpdateState | null {
  try {
    const raw = readFileSync(STATE_FILE(), 'utf-8');
    return JSON.parse(raw) as UpdateState;
  } catch {
    return null;
  }
}

function writeState(state: UpdateState): void {
  try {
    writeFileSync(STATE_FILE(), JSON.stringify(state));
  } catch { /* ignore */ }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await proxyFetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}

let pendingNotification: string | null = null;

export function getPendingUpdateNotification(): string | null {
  return pendingNotification;
}

export async function checkForUpdate(currentVersion: string): Promise<void> {
  // Skip in CI / non-TTY environments
  if (process.env.CI || !process.stderr.isTTY) return;

  const state = readState();
  const now = Date.now();

  // Throttle: skip if checked within the last 24h
  if (state && now - state.lastChecked < CHECK_INTERVAL_MS) {
    if (state.latestVersion && state.latestVersion !== `v${currentVersion}`) {
      pendingNotification = state.latestVersion;
    }
    return;
  }

  const latest = await fetchLatestVersion();
  if (!latest) return;

  writeState({ lastChecked: now, latestVersion: latest });

  if (latest !== `v${currentVersion}`) {
    pendingNotification = latest;
  }
}
