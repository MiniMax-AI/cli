import { defineCommand } from '../../command';
import {
  applyAgentConfigurations,
  prepareAgentConfigurations,
} from '../../agent/configurator';
import {
  AGENT_IDS,
  type AgentId,
  type AgentSetupOptions,
  type AgentVerification,
} from '../../agent/types';
import { verifyAgentCredential } from '../../agent/verify';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import {
  promptConfirm,
  promptMultiSelect,
  promptPassword,
  promptSelect,
} from '../../utils/prompt';
import { maskToken } from '../../utils/token';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

const AGENT_ALIASES: Record<string, AgentId> = {
  claude: 'claude-code',
  claudecode: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  grok: 'grok',
  'grok-build': 'grok',
  'grok-cli': 'grok',
  opencode: 'opencode',
  hermes: 'hermes',
  pi: 'pi',
};

const AGENT_LABELS: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok CLI (Grok Build)',
  opencode: 'OpenCode',
  hermes: 'Hermes Agent',
  pi: 'Pi',
};

function uniqueAgents(values: string[]): AgentId[] {
  const result: AgentId[] = [];
  for (const raw of values) {
    const normalized = raw.trim().toLowerCase();
    const agent = AGENT_ALIASES[normalized];
    if (!agent) {
      throw new CLIError(
        `Unsupported agent "${raw}".`,
        ExitCode.USAGE,
        `Supported agents: ${AGENT_IDS.join(', ')}`,
      );
    }
    if (!result.includes(agent)) result.push(agent);
  }
  return result;
}

function isInteractiveInvocation(flags: GlobalFlags): boolean {
  if (flags._hasExplicitOptions === true) return false;
  return Object.values(flags).every((value) => value === undefined || value === false);
}

async function interactiveOptions(
  config: Config,
): Promise<AgentSetupOptions> {
  const selectedAgents = await promptMultiSelect({
    message: 'Select agents to configure',
    choices: AGENT_IDS.map((agent) => ({ value: agent, label: AGENT_LABELS[agent] })),
    initialValues: ['claude-code', 'codex'],
    required: true,
  });
  if (!selectedAgents?.length) {
    throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);
  }
  const agents = uniqueAgents(selectedAgents);

  const selectedRegion = await promptSelect({
    message: 'Select your MiniMax service region',
    choices: [
      { value: 'global', label: 'Global (minimax.io)' },
      { value: 'cn', label: 'Mainland China (minimaxi.com)' },
    ],
    initialValue: config.region,
  });
  if (selectedRegion !== 'global' && selectedRegion !== 'cn') {
    throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);
  }
  let apiKey = config.apiKey ?? config.fileApiKey;
  if (apiKey) {
    const reuse = await promptConfirm({
      message: `Use the saved mmx API key (${maskToken(apiKey)})?`,
    });
    if (reuse === undefined) throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);
    if (!reuse) apiKey = undefined;
  }
  if (!apiKey) {
    apiKey = (await promptPassword({ message: 'MiniMax API key' }))?.trim();
  }
  if (!apiKey) throw new CLIError('An API key is required.', ExitCode.USAGE);

  const confirmed = await promptConfirm({
    message: `Configure ${agents.map((agent) => AGENT_LABELS[agent]).join(', ')}?`,
  });
  if (!confirmed) throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);

  return { agents, apiKey, region: selectedRegion, model: 'MiniMax-M3' };
}

function nonInteractiveOptions(
  config: Config,
  flags: GlobalFlags,
): AgentSetupOptions {
  const positional = flags._positional as string[] | undefined;
  if (positional?.length) {
    throw new CLIError(
      `Unexpected positional argument: ${positional[0]}`,
      ExitCode.USAGE,
      'Select agents with --agent <name> or --all.',
    );
  }
  const requested = uniqueAgents((flags.agent as string[] | undefined) ?? []);
  const selected = flags.all ? [...AGENT_IDS] : requested;
  if (selected.length === 0) {
    throw new CLIError(
      'At least one --agent or --all is required in non-interactive mode.',
      ExitCode.USAGE,
      'mmx agent setup --agent codex --api-key <key> --region global',
    );
  }

  if (flags.region !== 'global' && flags.region !== 'cn') {
    throw new CLIError(
      '--region global|cn is required in non-interactive mode.',
      ExitCode.USAGE,
      'Supplying the region makes scripts deterministic and prevents writing configs for the wrong service.',
    );
  }

  const apiKey = ((flags.apiKey as string | undefined) ?? config.fileApiKey)?.trim();
  if (!apiKey) {
    throw new CLIError(
      'An API key is required in non-interactive mode.',
      ExitCode.USAGE,
      'Pass --api-key <key>, or save one first with mmx config set --key api_key --value <key>.',
    );
  }

  const model = ((flags.model as string | undefined) ?? 'MiniMax-M3').trim();
  if (!model) throw new CLIError('--model must not be empty.', ExitCode.USAGE);
  if (model !== 'MiniMax-M3') {
    throw new CLIError(
      'Agent setup currently supports only --model MiniMax-M3.',
      ExitCode.USAGE,
      'Other MiniMax models have different context and output limits.',
    );
  }
  return { agents: selected, apiKey, region: flags.region, model };
}

export default defineCommand({
  name: 'agent setup',
  description: 'Configure MiniMax for external coding agents',
  usage: 'mmx agent setup [--agent <name> ... | --all] [--api-key <key>] [--region <region>]',
  options: [
    {
      flag: '--agent <name>',
      description: 'Agent: claude-code, codex, grok/grok-build, opencode, hermes, pi (repeatable)',
      type: 'array',
    },
    { flag: '--all', description: 'Configure every supported agent' },
    { flag: '--model <model>', description: 'Model ID (currently MiniMax-M3 only)' },
    { flag: '--skip-verify', description: 'Skip the live MiniMax API verification' },
  ],
  examples: [
    'mmx agent setup',
    'mmx agent setup --agent claude-code --agent codex --api-key <key> --region global',
    'mmx agent setup --all --api-key <key> --region cn --output json',
    'mmx agent setup --agent opencode --api-key <key> --region cn --dry-run',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const options = isInteractiveInvocation(flags)
      ? await interactiveOptions(config)
      : nonInteractiveOptions(config, flags);

    let verification: AgentVerification = {
      region: options.region,
      model: options.model,
      endpoint: '',
      status: 'skipped',
    };
    if (!flags.skipVerify && !config.dryRun) {
      verification = await verifyAgentCredential({
        apiKey: options.apiKey,
        region: options.region,
        model: options.model,
        timeoutSeconds: Math.min(config.timeout, 60),
      });
    }

    const prepared = prepareAgentConfigurations(options);
    const files = applyAgentConfigurations(prepared, config.dryRun);
    const format = detectOutputFormat(config.output);
    console.log(formatOutput({
      verification,
      agents: options.agents,
      files,
    }, format));
  },
});
