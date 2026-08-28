import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { endpointsForRegion } from './configurator';
import type { AgentVerification } from './types';
import type { Region } from '../config/schema';

interface ErrorResponse {
  error?: { message?: string };
  base_resp?: { status_msg?: string };
}

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
    let detail = '';
    try {
      const body = await response.json() as ErrorResponse;
      detail = body.error?.message ?? body.base_resp?.status_msg ?? '';
    } catch {
      // The status code is enough when the upstream body is not JSON.
    }
    throw new CLIError(
      `MiniMax rejected the agent verification request (${response.status})${detail ? `: ${detail}` : '.'}`,
      response.status === 401 || response.status === 403 ? ExitCode.AUTH : ExitCode.GENERAL,
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
