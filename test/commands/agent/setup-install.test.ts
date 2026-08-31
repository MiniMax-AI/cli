import { describe, expect, it } from 'bun:test';

import {
  installSelectedAgents,
  selectMissingAgentInstallations,
} from '../../../src/commands/agent/setup';
import { CLIError } from '../../../src/errors/base';
import type { AgentId } from '../../../src/agent/types';

describe('agent setup installation flow', () => {
  it('offers only selected agents that are missing and defaults them on', async () => {
    const selected = await selectMissingAgentInstallations(
      ['claude-code', 'codex', 'pi'],
      new Set(['codex']),
      {
        select: async (options) => {
          expect(options.choices.map(choice => choice.value)).toEqual(['claude-code', 'pi']);
          expect(options.initialValues).toEqual(['claude-code', 'pi']);
          expect(options.required).toBe(false);
          return ['pi'];
        },
        note: async () => {},
        getIssue: () => undefined,
      },
    );

    expect(selected).toEqual(['pi']);
  });

  it('allows the user to install none of the missing agents', async () => {
    const selected = await selectMissingAgentInstallations(
      ['codex'],
      new Set(),
      { select: async () => [], note: async () => {}, getIssue: () => undefined },
    );
    expect(selected).toEqual([]);
  });

  it('treats cancelling the installation list as cancelling setup', async () => {
    await expect(selectMissingAgentInstallations(
      ['codex'],
      new Set(),
      { select: async () => undefined, note: async () => {}, getIssue: () => undefined },
    )).rejects.toThrow('Agent setup cancelled.');
  });

  it('does not prompt when every selected agent is already installed', async () => {
    let prompted = false;
    const selected = await selectMissingAgentInstallations(
      ['codex'],
      new Set(['codex']),
      {
        select: async () => {
          prompted = true;
          return [];
        },
        note: async () => {},
        getIssue: () => undefined,
      },
    );
    expect(selected).toEqual([]);
    expect(prompted).toBe(false);
  });

  it('explains incompatible installers before showing only installable choices', async () => {
    let note = '';
    const selected = await selectMissingAgentInstallations(
      ['claude-code', 'pi'],
      new Set(),
      {
        select: async (options) => {
          expect(options.choices.map(choice => choice.value)).toEqual(['claude-code']);
          return ['claude-code'];
        },
        note: async ({ message }) => { note = message; },
        getIssue: agent => agent === 'pi' ? 'Pi requires Node.js 22.19 or newer.' : undefined,
      },
    );
    expect(selected).toEqual(['claude-code']);
    expect(note).toContain('Pi requires Node.js 22.19 or newer');
    expect(note).toContain('configuration-only');
  });

  it('offers Grok and Hermes when their official installers are available', async () => {
    const selected = await selectMissingAgentInstallations(
      ['grok', 'hermes', 'codex'],
      new Set(),
      {
        select: async (options) => {
          expect(options.choices.map(choice => choice.value)).toEqual(['grok', 'hermes', 'codex']);
          return ['grok', 'hermes'];
        },
        note: async () => {},
        getIssue: () => undefined,
      },
    );

    expect(selected).toEqual(['grok', 'hermes']);
  });

  it('installs only the chosen agents and marks only successful installs detected', async () => {
    const installed: AgentId[] = [];
    const detected = new Set<AgentId>();
    let proxy: string | undefined;
    await installSelectedAgents(['pi'], detected, { proxy: 'http://proxy.example:8080' }, {
      getCommand: () => ({ executable: 'npm', args: [], display: 'install pi' }),
      install: async (agent, options) => {
        installed.push(agent);
        proxy = options.proxy;
      },
      note: async () => {},
      confirm: async () => false,
    });

    expect(installed).toEqual(['pi']);
    expect(proxy).toBe('http://proxy.example:8080');
    expect(detected).toEqual(new Set(['pi']));
  });

  it('can continue configuration after an installation failure', async () => {
    const detected = new Set<AgentId>();
    let confirmation = '';
    await installSelectedAgents(['codex'], detected, {}, {
      getCommand: () => ({ executable: 'npm', args: [], display: 'install codex' }),
      install: async () => { throw new CLIError('install failed'); },
      note: async () => {},
      confirm: async ({ message }) => {
        confirmation = message;
        return true;
      },
    });

    expect(confirmation).toContain('Continue and configure Codex');
    expect(detected).toEqual(new Set());
  });

  it('stops configuration when the user declines after an installation failure', async () => {
    const failure = new CLIError('install failed');
    await expect(installSelectedAgents(['codex'], new Set(), {}, {
      getCommand: () => ({ executable: 'npm', args: [], display: 'install codex' }),
      install: async () => { throw failure; },
      note: async () => {},
      confirm: async () => false,
    })).rejects.toBe(failure);
  });
});
