import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { parseSSE } from '../client/stream';
import { endpointsForRegion } from './configurator';
import type { AgentVerification } from './types';
import type { Region } from '../config/schema';

export async function verifyAgentCredential(options: {
  apiKey: string;
  region: Region;
  model: string;
  timeoutSeconds?: number;
}): Promise<AgentVerification> {
  const endpoint = `${endpointsForRegion(options.region).openai}/responses`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        input: 'Reply with exactly OK.',
        max_output_tokens: 16,
        stream: true,
      }),
      signal: AbortSignal.timeout((options.timeoutSeconds ?? 30) * 1000),
    });
  } catch (error) {
    throw new CLIError(
      `Could not reach the MiniMax agent endpoint: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.NETWORK,
      'No agent configuration files were changed.',
    );
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new CLIError(
      `MiniMax rejected the agent verification request (${response.status}).`,
      response.status === 401 || response.status === 403 ? ExitCode.AUTH : ExitCode.GENERAL,
      'No agent configuration files were changed. Check --region, --model, and the API key.',
    );
  }

  let verified = false;
  try {
    for await (const event of parseSSE(response)) {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        continue;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;
      const record = payload as Record<string, unknown>;
      const created = record.response;
      if (record.type === 'response.created'
        && typeof created === 'object'
        && created !== null
        && !Array.isArray(created)
        && typeof (created as Record<string, unknown>).id === 'string'
        && typeof (created as Record<string, unknown>).model === 'string') {
        verified = true;
        break;
      }
    }
  } catch {
    throw new CLIError(
      'Could not read the MiniMax agent verification response.',
      ExitCode.NETWORK,
      'No agent configuration files were changed.',
    );
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }

  if (!verified) {
    throw new CLIError(
      'MiniMax returned an invalid agent verification response.',
      ExitCode.GENERAL,
      'No agent configuration files were changed. Check --region, --model, and the API key.',
    );
  }

  return {
    region: options.region,
    model: options.model,
    endpoint,
    status: 'ok',
  };
}
