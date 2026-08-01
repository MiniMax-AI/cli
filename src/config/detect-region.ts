import { REGIONS, type Region } from './schema';
import { readConfigFile, writeConfigFile } from './loader';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { usageEndpoint } from '../client/endpoints';

type ProbeResult = "authorized" | "unauthorized" | "unreachable" | "inconclusive";

async function probeRegion(
  region: Region,
  apiKey: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  // MiniMax endpoints accept either Bearer or x-api-key auth — try both.
  // Some API key types only work with one style; trying both prevents false
  // negatives that would cause the wrong region to be selected, leading to
  // every subsequent request timing out or returning 401.
  const authHeaders: Record<string, string>[] = [
    { Authorization: `Bearer ${apiKey}` },
    { "x-api-key": apiKey },
  ];

  let sawNetworkFailure = false;
  let sawInconclusiveResponse = false;

  for (const authHeader of authHeaders) {
    let res: Response;
    try {
      res = await fetch(usageEndpoint(REGIONS[region], apiKey), {
        headers: { ...authHeader, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      sawNetworkFailure = true;
      continue;
    }

    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) {
      sawInconclusiveResponse = true;
      continue;
    }

    try {
      const data = (await res.json()) as {
        base_resp?: { status_code?: number };
      };
      if (data.base_resp?.status_code === 0) return "authorized";
      sawInconclusiveResponse = true;
    } catch {
      sawInconclusiveResponse = true;
    }
  }

  if (sawInconclusiveResponse) return "inconclusive";
  if (sawNetworkFailure) return "unreachable";
  return "unauthorized";
}

export async function detectRegion(apiKey: string): Promise<Region> {
  process.stderr.write("Detecting region...");
  const regions = Object.keys(REGIONS) as Region[];
  const results = await Promise.all(
    regions.map(async (r) => ({
      region: r,
      result: await probeRegion(r, apiKey, 5000),
    })),
  );
  const match = results.find((r) => r.result === "authorized");
  if (!match) {
    process.stderr.write(" failed\n");
    const authHint = apiKey.startsWith('sk-api-')
      ? 'No credentials were changed. Check that the key is valid and belongs to an API secret key.'
      : 'No credentials were changed. Check that the key is valid and belongs to a Token Plan.';

    if (results.every((r) => r.result === "unauthorized")) {
      throw new CLIError(
        "API key was rejected by all regions.",
        ExitCode.AUTH,
        authHint,
      );
    }

    if (results.some((r) => r.result === "unreachable")) {
      throw new CLIError(
        "Could not reach the regional API endpoints.",
        ExitCode.NETWORK,
        "No region was changed. Check the network or proxy, then retry or pass --region global|cn explicitly.",
      );
    }

    throw new CLIError(
      "Could not determine the API key region.",
      ExitCode.GENERAL,
      "No region was changed because the API returned an inconclusive response. Retry later or pass --region global|cn explicitly.",
    );
  }
  const detected: Region = match.region;
  process.stderr.write(` ${detected}\n`);
  return detected;
}

export async function saveDetectedRegion(region: Region): Promise<void> {
  const existing = readConfigFile() as Record<string, unknown>;
  existing.region = region;
  await writeConfigFile(existing);
}
