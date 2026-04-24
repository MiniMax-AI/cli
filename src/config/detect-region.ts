import { REGIONS, type Region } from "./schema";
import { readConfigFile, writeConfigFile } from "./loader";

const QUOTA_PATH = "/v1/token_plan/remains";

function quotaUrl(region: Region): string {
  return REGIONS[region] + QUOTA_PATH;
}

async function probeRegion(
  region: Region,
  apiKey: string,
  timeoutMs: number,
): Promise<boolean> {
  // MiniMax endpoints accept either Bearer or x-api-key auth — try both.
  // Some API key types only work with one style; trying both prevents false
  // negatives that would cause the wrong region to be selected, leading to
  // every subsequent request timing out or returning 401.
  const authHeaders: Record<string, string>[] = [
    { Authorization: `Bearer ${apiKey}` },
    { "x-api-key": apiKey },
  ];

  for (const authHeader of authHeaders) {
    try {
      const res = await fetch(quotaUrl(region), {
        headers: { ...authHeader, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        base_resp?: { status_code?: number };
      };
      if (data.base_resp?.status_code === 0) return true;
    } catch {
      // Try next auth style before giving up on this region
    }
  }
  return false;
}

export async function detectRegion(apiKey: string): Promise<Region> {
  process.stderr.write("Detecting region...");
  const regions = Object.keys(REGIONS) as Region[];
  const results = await Promise.all(
    regions.map(async (r) => ({
      region: r,
      ok: await probeRegion(r, apiKey, 5000),
    })),
  );
  const match = results.find((r) => r.ok);
  if (!match) {
    process.stderr.write(" failed\n");
    process.stderr.write(
      `Warning: API key failed validation against all regions (global, cn).\n` +
      `  This usually means the API key is invalid or the network is blocking requests.\n` +
      `  Falling back to 'global'. Subsequent requests may fail.\n` +
      `  Run 'mmx auth status' to verify your credentials.\n`,
    );
    return "global";
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
