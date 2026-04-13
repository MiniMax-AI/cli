import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { discoverExternalCredential } from '../../src/auth/discover';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('discoverExternalCredential', () => {
  const testDir = join(tmpdir(), `mmx-discover-test-${Date.now()}`);
  const originalHome = process.env.HOME;

  const authProfilesDir = join(testDir, '.openclaw', 'agents', 'main', 'agent');
  const authProfilesPath = join(authProfilesDir, 'auth-profiles.json');
  const openclawConfigPath = join(testDir, '.openclaw', 'openclaw.json');

  beforeEach(() => {
    mkdirSync(authProfilesDir, { recursive: true });
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns null when no OpenClaw directory exists', () => {
    rmSync(join(testDir, '.openclaw'), { recursive: true, force: true });
    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });

  it('discovers API key from minimax:global profile', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-test-global-key',
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-test-global-key');
    expect(result!.region).toBe('global');
    expect(result!.source).toBe('OpenClaw auth-profiles.json');
  });

  it('discovers API key from minimax:cn profile', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:cn': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-test-cn-key',
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-test-cn-key');
    expect(result!.region).toBe('cn');
  });

  it('extracts access field from OAuth profile as API key', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax-portal:default': {
          type: 'oauth',
          provider: 'minimax-portal',
          access: 'sk-oauth-access-key',
          refresh: 'refresh-token',
          expires: Date.now() + 3600000,
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-oauth-access-key');
    expect(result!.source).toBe('OpenClaw auth-profiles.json');
  });

  it('prefers API key profile over OAuth profile', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-api-key',
        },
        'minimax-portal:default': {
          type: 'oauth',
          provider: 'minimax-portal',
          access: 'sk-oauth-key',
          refresh: 'refresh',
          expires: Date.now() + 3600000,
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-api-key');
  });

  it('prefers global over cn when both present', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-global',
        },
        'minimax:cn': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-cn',
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-global');
    expect(result!.region).toBe('global');
  });

  it('discovers API key from openclaw.json config', () => {
    writeFileSync(openclawConfigPath, JSON.stringify({
      models: {
        providers: {
          minimax: {
            apiKey: 'sk-config-key',
          },
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-config-key');
    expect(result!.source).toBe('OpenClaw config');
  });

  it('prefers auth-profiles.json over openclaw.json', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'api_key',
          provider: 'minimax',
          key: 'sk-from-profiles',
        },
      },
    }));
    writeFileSync(openclawConfigPath, JSON.stringify({
      models: {
        providers: {
          minimax: {
            apiKey: 'sk-from-config',
          },
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('sk-from-profiles');
    expect(result!.source).toBe('OpenClaw auth-profiles.json');
  });

  it('returns null for corrupted JSON', () => {
    writeFileSync(authProfilesPath, '{not valid json!!!');
    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });

  it('returns null for wrong schema (missing profiles key)', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      something_else: {},
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });

  it('skips profiles with unknown type', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'saml',
          provider: 'minimax',
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });

  it('skips API key profile with empty key', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax:global': {
          type: 'api_key',
          provider: 'minimax',
          key: '',
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });

  it('skips OAuth profile with empty access', () => {
    writeFileSync(authProfilesPath, JSON.stringify({
      version: 1,
      profiles: {
        'minimax-portal:default': {
          type: 'oauth',
          provider: 'minimax-portal',
          access: '',
          refresh: 'refresh',
          expires: Date.now(),
        },
      },
    }));

    const result = discoverExternalCredential(testDir);
    expect(result).toBeNull();
  });
});
