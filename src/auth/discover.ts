import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface DiscoveredCredential {
  key: string;
  source: string;
  region?: 'global' | 'cn';
}

const OPENCLAW_AUTH_PROFILES_PATH = join(
  '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json',
);
const OPENCLAW_CONFIG_PATH = join('.openclaw', 'openclaw.json');

const API_KEY_PROFILE_IDS: Array<{ id: string; region: 'global' | 'cn' }> = [
  { id: 'minimax:global', region: 'global' },
  { id: 'minimax:cn', region: 'cn' },
];

function tryReadJson(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function probeAuthProfiles(home: string): DiscoveredCredential | null {
  const filePath = join(home, OPENCLAW_AUTH_PROFILES_PATH);
  const data = tryReadJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const store = data as Record<string, unknown>;
  if (typeof store.profiles !== 'object' || !store.profiles) return null;
  const profiles = store.profiles as Record<string, unknown>;

  // 1. Check API key profiles (preferred)
  for (const { id, region } of API_KEY_PROFILE_IDS) {
    const profile = profiles[id];
    if (!profile || typeof profile !== 'object') continue;
    const p = profile as Record<string, unknown>;
    if (p.type === 'api_key' && typeof p.key === 'string' && p.key.length > 0) {
      return { key: p.key, source: 'OpenClaw auth-profiles.json', region };
    }
  }

  // 2. Check OAuth profiles (access field holds the API key)
  for (const [id, profile] of Object.entries(profiles)) {
    if (!id.startsWith('minimax-portal:')) continue;
    if (!profile || typeof profile !== 'object') continue;
    const p = profile as Record<string, unknown>;
    if (p.type === 'oauth' && typeof p.access === 'string' && p.access.length > 0) {
      return { key: p.access, source: 'OpenClaw auth-profiles.json' };
    }
  }

  return null;
}

function probeOpenClawConfig(home: string): DiscoveredCredential | null {
  const filePath = join(home, OPENCLAW_CONFIG_PATH);
  const data = tryReadJson(filePath);
  if (!data || typeof data !== 'object') return null;

  const models = (data as Record<string, unknown>).models;
  if (!models || typeof models !== 'object') return null;

  const providers = (models as Record<string, unknown>).providers;
  if (!providers || typeof providers !== 'object') return null;

  const p = providers as Record<string, unknown>;
  for (const providerKey of ['minimax', 'minimax-portal']) {
    const entry = p[providerKey];
    if (!entry || typeof entry !== 'object') continue;
    const apiKey = (entry as Record<string, unknown>).apiKey;
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      return { key: apiKey, source: 'OpenClaw config' };
    }
  }

  return null;
}

export function discoverExternalCredential(homeDir?: string): DiscoveredCredential | null {
  const home = homeDir ?? homedir();

  return probeAuthProfiles(home) ?? probeOpenClawConfig(home) ?? null;
}
