import colors from 'picocolors';

import { defineCommand } from '../../command';
import {
  applyAgentConfigurations,
  prepareAgentConfigurations,
  withAgentSetupLock,
} from '../../agent/configurator';
import { detectAvailableAgents } from '../../agent/availability';
import {
  getAgentInstallCommand,
  getAgentInstallIssue,
  installAgent,
} from '../../agent/installer';
import {
  AGENT_IDS,
  DEFAULT_MINIMAX_MODEL,
  MINIMAX_MODELS,
  type AgentId,
  type AgentSetupOptions,
  type AgentVerification,
  type AppliedAgentFile,
} from '../../agent/types';
import { verifyAgentCredential } from '../../agent/verify';
import { readConfigFile } from '../../config/loader';
import { DOCS_HOSTS, type Config } from '../../config/schema';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import {
  promptConfirm,
  promptApiKey,
  promptMultiSelect,
  promptNote,
  promptSelect,
  withPromptSpinner,
} from '../../utils/prompt';
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
const DEFAULT_INTERACTIVE_AGENTS: AgentId[] = ['claude-code', 'codex'];

interface SelectedAgentSetup extends AgentSetupOptions {
  agentsToInstall: AgentId[];
}

type ApiKeyKind = 'token-plan' | 'paygo';

interface AgentInstallationDependencies {
  getCommand(agent: AgentId): ReturnType<typeof getAgentInstallCommand>;
  install(agent: AgentId, options: { proxy?: string }): Promise<void>;
  note(options: { title: string; message: string }): Promise<void>;
  confirm(options: { message: string }): Promise<boolean | undefined>;
}

interface MissingAgentSelectionDependencies {
  select: typeof promptMultiSelect;
  note: typeof promptNote;
  getIssue(agent: AgentId): string | undefined;
}

const AGENT_INSTALLATION_DEPENDENCIES: AgentInstallationDependencies = {
  getCommand: getAgentInstallCommand,
  install: installAgent,
  note: promptNote,
  confirm: promptConfirm,
};

const MISSING_AGENT_SELECTION_DEPENDENCIES: MissingAgentSelectionDependencies = {
  select: promptMultiSelect,
  note: promptNote,
  getIssue: getAgentInstallIssue,
};

const API_KEY_CHOICES: Array<{
  value: ApiKeyKind;
  label: string;
  hint: string;
  pagePath: string;
  noteTitle: string;
  prompt: string;
}> = [
  {
    value: 'token-plan',
    label: 'Token Plan (sk-cp-...)',
    hint: 'Uses plan quota and Credits',
    pagePath: '/user-center/payment/token-plan',
    noteTitle: 'Get your Token Plan key',
    prompt: 'Paste your Token Plan key',
  },
  {
    value: 'paygo',
    label: 'Pay-as-you-go (sk-api-...)',
    hint: 'Uses account balance',
    pagePath: '/user-center/basic-information/interface-key',
    noteTitle: 'Create a pay-as-you-go key',
    prompt: 'Paste your pay-as-you-go key',
  },
];

function detectApiKeyKind(apiKey: string): ApiKeyKind | undefined {
  if (apiKey.startsWith('sk-cp-')) return 'token-plan';
  if (apiKey.startsWith('sk-api-')) return 'paygo';
  return undefined;
}

function formatAgentSetupResult(
  result: {
    verification: AgentVerification;
    agents: AgentId[];
    files: AppliedAgentFile[];
  },
  format: 'text' | 'json',
  color: boolean,
): string {
  if (format === 'json' || !color) return formatOutput(result, format);

  const key = colors.cyan;
  const value = colors.green;
  return formatOutput({
    [key('verification')]: {
      [key('region')]: result.verification.region,
      [key('model')]: result.verification.model,
      [key('endpoint')]: result.verification.endpoint,
      [key('status')]: value(result.verification.status),
    },
    [key('agents')]: result.agents.map((agent) => value(agent)),
    [key('files')]: result.files.map((file) => ({
      [key('agent')]: value(file.agent),
      [key('path')]: file.path,
      [key('status')]: value(file.status),
      ...(file.backup ? { [key('backup')]: file.backup } : {}),
    })),
  }, 'text');
}

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

export async function selectMissingAgentInstallations(
  agents: AgentId[],
  detectedAgents: Set<AgentId>,
  dependencies: MissingAgentSelectionDependencies = MISSING_AGENT_SELECTION_DEPENDENCIES,
): Promise<AgentId[]> {
  const missingAgents = agents.filter((agent) => !detectedAgents.has(agent));
  if (missingAgents.length === 0) return [];

  const unavailable = missingAgents.flatMap((agent) => {
    const issue = dependencies.getIssue(agent);
    return issue ? [{ agent, issue }] : [];
  });
  if (unavailable.length > 0) {
    await dependencies.note({
      title: 'Unavailable installers',
      message: unavailable.map(({ agent, issue }) => `${AGENT_LABELS[agent]}: ${issue}`).join('\n')
        + '\n\nThese agents will remain configuration-only.',
    });
  }
  const installableAgents = missingAgents.filter(
    (agent) => !unavailable.some(candidate => candidate.agent === agent),
  );
  if (installableAgents.length === 0) return [];

  const selected = await dependencies.select({
    message: 'Select missing agents to install',
    choices: installableAgents.map((agent) => ({
      value: agent,
      label: AGENT_LABELS[agent],
    })),
    initialValues: installableAgents,
    required: false,
  });
  if (selected === undefined) {
    throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);
  }
  return uniqueAgents(selected);
}

export async function installSelectedAgents(
  agents: AgentId[],
  detectedAgents: Set<AgentId>,
  options: { proxy?: string } = {},
  dependencies: AgentInstallationDependencies = AGENT_INSTALLATION_DEPENDENCIES,
): Promise<void> {
  for (const agent of agents) {
    const command = dependencies.getCommand(agent);
    await dependencies.note({
      title: `Install ${AGENT_LABELS[agent]}`,
      message: `$ ${command.display}`,
    });
    try {
      await dependencies.install(agent, options);
      detectedAgents.add(agent);
    } catch (error) {
      const detail = error instanceof CLIError
        ? `${error.message}${error.hint ? `\n\n${error.hint}` : ''}`
        : error instanceof Error ? error.message : String(error);
      await dependencies.note({ title: 'Installation failed', message: detail });
      const continueSetup = await dependencies.confirm({
        message: `Continue and configure ${AGENT_LABELS[agent]} without installing it?`,
      });
      if (!continueSetup) throw error;
    }
  }
}

async function interactiveOptions(
  config: Config,
  detectedAgents: Set<AgentId>,
): Promise<SelectedAgentSetup> {
  const selectedAgents = await promptMultiSelect({
    message: 'Select agents to configure',
    choices: AGENT_IDS.map((agent) => ({
      value: agent,
      label: detectedAgents.has(agent)
        ? AGENT_LABELS[agent]
        : `${AGENT_LABELS[agent]} (not detected on PATH)`,
    })),
    initialValues: DEFAULT_INTERACTIVE_AGENTS.filter((agent) => detectedAgents.has(agent)),
    required: true,
  });
  if (!selectedAgents?.length) {
    throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);
  }
  const agents = uniqueAgents(selectedAgents);

  const notDetected = agents.filter((agent) => !detectedAgents.has(agent));
  const agentsToInstall = await selectMissingAgentInstallations(agents, detectedAgents);

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
  const selectedKeyKind = await promptSelect({
    message: 'Choose an API key type',
    choices: API_KEY_CHOICES,
    initialValue: 'token-plan',
  });
  const keyChoice = API_KEY_CHOICES.find(choice => choice.value === selectedKeyKind);
  if (!keyChoice) throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);

  await promptNote({
    title: keyChoice.noteTitle,
    message: `${DOCS_HOSTS[selectedRegion]}${keyChoice.pagePath}\n\nCopy the key, then paste it below.`,
  });
  const apiKey = (await promptApiKey({
    message: keyChoice.prompt,
  }))?.trim();

  const detectedKind = apiKey ? detectApiKeyKind(apiKey) : undefined;
  if (detectedKind && detectedKind !== keyChoice.value) {
    const detectedChoice = API_KEY_CHOICES.find(choice => choice.value === detectedKind);
    if (detectedChoice) {
      await promptNote({
        title: 'API key type detected',
        message: `This looks like ${detectedChoice.label}. ${detectedChoice.hint}.`,
      });
    }
  }
  if (!apiKey) {
    throw new CLIError('A MiniMax API key is required.', ExitCode.USAGE);
  }

  let message = `Configure ${agents.map((agent) => AGENT_LABELS[agent]).join(', ')}? `
    + 'mmx will write configuration files.';
  if (agentsToInstall.length > 0) {
    message += ` It will first install ${agentsToInstall.map((agent) => AGENT_LABELS[agent]).join(', ')} `
      + 'using their official installers.';
  }
  const configurationOnly = notDetected.filter((agent) => !agentsToInstall.includes(agent));
  if (configurationOnly.length > 0) {
    message += ` Configuration only: ${configurationOnly.map((agent) => AGENT_LABELS[agent]).join(', ')}.`;
  }
  const confirmed = await promptConfirm({ message });
  if (!confirmed) throw new CLIError('Agent setup cancelled.', ExitCode.GENERAL);

  return {
    agents,
    agentsToInstall,
    apiKey,
    region: selectedRegion,
    model: DEFAULT_MINIMAX_MODEL,
  };
}

function nonInteractiveOptions(flags: GlobalFlags): SelectedAgentSetup {
  const positional = flags._positional as string[] | undefined;
  if (positional?.length) {
    throw new CLIError(
      'Unexpected positional argument.',
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

  const apiKey = (flags.apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new CLIError(
      'A MiniMax API key is required in non-interactive mode.',
      ExitCode.USAGE,
      'Pass --api-key <key>.\n'
        + 'Token Plan keys (sk-cp-...) and pay-as-you-go keys (sk-api-...) use separate quotas.',
    );
  }

  const model = ((flags.model as string | undefined) ?? DEFAULT_MINIMAX_MODEL).trim();
  if (!model) throw new CLIError('--model must not be empty.', ExitCode.USAGE);
  const supportedModel = MINIMAX_MODELS.find(candidate => candidate.id === model)?.id;
  if (!supportedModel) {
    throw new CLIError(
      `Unsupported MiniMax model "${model}".`,
      ExitCode.USAGE,
      `Supported models: ${MINIMAX_MODELS.map(candidate => candidate.id).join(', ')}`,
    );
  }
  return {
    agents: selected,
    agentsToInstall: [],
    apiKey,
    region: flags.region,
    model: supportedModel,
  };
}

export default defineCommand({
  name: 'agent setup',
  description: 'Configure coding agents using a MiniMax API key and optionally install missing agents',
  usage: 'mmx agent setup [--agent <name> ... | --all] [--api-key <key>] [--region <region>]',
  options: [
    {
      flag: '--agent <name>',
      description: 'Agent: claude-code, codex, grok/grok-build, opencode, hermes, pi (repeatable)',
      type: 'array',
    },
    {
      flag: '--api-key <key>',
      description: 'API key only; Token Plan (sk-cp) and pay-as-you-go (sk-api) keys are not interchangeable',
    },
    { flag: '--all', description: 'Configure every supported agent' },
    {
      flag: '--model <model>',
      description: `Default model (${MINIMAX_MODELS.map(model => model.id).join(', ')})`,
    },
  ],
  examples: [
    'mmx agent setup',
    'mmx agent setup --agent claude-code --agent codex --api-key <key> --region global',
    'mmx agent setup --all --api-key <key> --region cn --output json',
    'mmx agent setup --agent opencode --api-key <key> --region cn --dry-run',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const detectedAgents = detectAvailableAgents();
    const interactive = isInteractiveInvocation(flags);
    const options = interactive
      ? await interactiveOptions(config, detectedAgents)
      : nonInteractiveOptions(flags);
    const configuredProxy = readConfigFile().proxy;

    let verification: AgentVerification = {
      region: options.region,
      model: options.model,
      endpoint: '',
      status: 'skipped',
    };
    if (!config.dryRun) {
      const verify = () => verifyAgentCredential({
        apiKey: options.apiKey,
        region: options.region,
        model: options.model,
        timeoutSeconds: Math.min(config.timeout, 60),
        proxy: configuredProxy,
      });
      verification = interactive ? await withPromptSpinner({
        message: 'Verifying API key with MiniMax...',
        successMessage: 'API key verified.',
        errorMessage: 'API key verification failed.',
      }, verify) : await verify();
    }

    const configure = async (lockHeld = false) => {
      let prepared = prepareAgentConfigurations(options);
      if (!config.dryRun) {
        await installSelectedAgents(options.agentsToInstall, detectedAgents, {
          proxy: configuredProxy,
        });
        if (options.agentsToInstall.length > 0) {
          prepared = prepareAgentConfigurations(options);
        }
      }
      return applyAgentConfigurations(prepared, config.dryRun, lockHeld);
    };
    const installsAgents = !config.dryRun && options.agentsToInstall.length > 0;
    const files = installsAgents
      ? await withAgentSetupLock(() => configure(true))
      : await configure();
    const format = detectOutputFormat(config.output);
    console.log(formatAgentSetupResult({
      verification,
      agents: options.agents,
      files,
    }, format, interactive && !config.noColor));
    const notDetected = options.agents.filter((agent) => !detectedAgents.has(agent));
    if (!interactive && notDetected.length > 0 && !config.quiet) {
      process.stderr.write(
        `Warning: Not detected on PATH: ${notDetected.map((agent) => AGENT_LABELS[agent]).join(', ')}. `
        + 'mmx can write configuration files for them, but will not download or install them for you.\n',
      );
    }
  },
});
