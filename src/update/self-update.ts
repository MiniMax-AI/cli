import { createWriteStream, renameSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const REPO = 'MiniMax-AI-Dev/minimax-cli';
const GH_API = 'https://api.github.com';

interface ManifestPlatform {
  checksum: string;
  size?: number;
}

interface Manifest {
  version: string;
  platforms: Record<string, ManifestPlatform>;
}

export interface UpdateTarget {
  version: string;  // resolved tag, e.g. "v0.2.0"
  downloadUrl: string;
  checksum: string;
}

export type Channel = 'stable' | 'latest' | string; // string = exact version tag

async function detectPlatform(): Promise<string> {
  const os = process.platform;
  const arch = process.arch;

  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux' };
  const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64' };

  const mappedOs = osMap[os];
  const mappedArch = archMap[arch];

  if (!mappedOs || !mappedArch) {
    throw new CLIError(`Unsupported platform: ${os}/${arch}`, ExitCode.GENERAL);
  }

  // Detect musl on Linux
  if (mappedOs === 'linux') {
    try {
      const { execSync } = await import('child_process');
      const ldd = execSync('ldd /bin/ls 2>&1', { encoding: 'utf-8' });
      if (ldd.includes('musl')) return `linux-${mappedArch}-musl`;
    } catch { /* non-fatal */ }
  }

  return `${mappedOs}-${mappedArch}`;
}

async function ghFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`${GH_API}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
}

async function resolveVersion(channel: Channel): Promise<string> {
  if (channel !== 'stable' && channel !== 'latest') {
    // Exact version: normalise to tag format
    return channel.startsWith('v') ? channel : `v${channel}`;
  }

  // latest = most recent release including pre-releases
  if (channel === 'latest') {
    const res = await ghFetch(`/repos/${REPO}/releases?per_page=1`);
    if (!res.ok) throw new CLIError('Failed to fetch releases from GitHub.', ExitCode.GENERAL);
    const releases = await res.json() as Array<{ tag_name: string }>;
    if (!releases.length) throw new CLIError('No releases found.', ExitCode.GENERAL);
    return releases[0].tag_name;
  }

  // stable = latest non-prerelease
  const res = await ghFetch(`/repos/${REPO}/releases/latest`);
  if (!res.ok) throw new CLIError('Failed to fetch latest release from GitHub.', ExitCode.GENERAL);
  const release = await res.json() as { tag_name: string };
  return release.tag_name;
}

async function fetchManifest(version: string): Promise<Manifest> {
  const url = `https://github.com/${REPO}/releases/download/${version}/manifest.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new CLIError(`manifest.json not found for ${version}.`, ExitCode.GENERAL);
  return res.json() as Promise<Manifest>;
}

async function verifySha256(filePath: string, expected: string): Promise<void> {
  const { createHash } = await import('crypto');
  const { readFileSync } = await import('fs');
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (actual !== expected) {
    throw new CLIError(
      `Checksum mismatch.\n  expected: ${expected}\n  actual:   ${actual}`,
      ExitCode.GENERAL,
    );
  }
}

// Exported for unit tests (see test/update/self-update.test.ts). Not part of
// the public CLI surface; callers go through `applySelfUpdate`.
export async function downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new CLIError(`Download failed: ${res.status} ${res.statusText}`, ExitCode.GENERAL);

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;

  const writer = createWriteStream(dest);
  const reader = res.body!.getReader();

  try {
    await new Promise<void>((resolve, reject) => {
      writer.on('error', reject);
      // Resolve only after the writer has actually flushed and closed —
      // otherwise verifySha256() can race the kernel's pagecache flush and
      // produce spurious checksum mismatches on slow disks.
      writer.on('finish', () => resolve());
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { writer.end(); break; }
            // Honour backpressure so we don't grow the writer's internal buffer
            // unboundedly on large binaries / slow disks.
            if (!writer.write(value)) {
              await new Promise<void>(r => writer.once('drain', r));
            }
            received += value.length;
            if (onProgress && total > 0) onProgress(Math.round(received / total * 100));
          }
        } catch (e) { reject(e); }
      };
      pump();
    });
  } catch (err) {
    // Tear down the writer BEFORE unlinking dest so any buffered bytes
    // can't race the unlink and leave a partial file in the pagecache, and
    // so a slow flush doesn't race the next process opening the same path.
    // Wait for `close` (fires after destroy on Node streams) unless the
    // writer has already torn down.
    if (!writer.destroyed) {
      await new Promise<void>(r => {
        writer.once('close', () => r());
        writer.destroy();
      });
    }
    // Don't leave a half-downloaded binary in /tmp on failure.
    try { (await import('fs')).unlinkSync(dest); } catch { /* best-effort — race with concurrent cleanup is fine */ }
    throw err;
  } finally {
    // Always release the Web Streams reader lock — the API contract requires
    // a paired acquire/release, and not doing so traps the underlying body.
    reader.releaseLock();
  }
}

export async function resolveUpdateTarget(channel: Channel): Promise<UpdateTarget> {
  const platform = await detectPlatform();
  const version = await resolveVersion(channel);
  const manifest = await fetchManifest(version);

  const entry = manifest.platforms[platform];
  if (!entry) {
    throw new CLIError(
      `Platform "${platform}" not found in manifest for ${version}.`,
      ExitCode.GENERAL,
    );
  }

  const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/mmx-${platform}`;
  return { version, downloadUrl, checksum: entry.checksum };
}

export async function applySelfUpdate(target: UpdateTarget, currentBin: string): Promise<void> {
  const tmp = join(tmpdir(), `mmx-update-${Date.now()}`);

  process.stderr.write(`Downloading ${target.version}...\n`);
  let lastPct = -1;
  await downloadFile(target.downloadUrl, tmp, (pct) => {
    if (pct !== lastPct && pct % 10 === 0) {
      process.stderr.write(`  ${pct}%\r`);
      lastPct = pct;
    }
  });
  process.stderr.write('  \r');

  process.stderr.write('Verifying checksum...\n');
  await verifySha256(tmp, target.checksum);

  chmodSync(tmp, 0o755);

  // Atomic replace: rename works on same filesystem
  // If cross-device, fall back to copy+rename
  try {
    renameSync(tmp, currentBin);
  } catch {
    const { copyFileSync, unlinkSync } = await import('fs');
    const backup = `${currentBin}.bak`;
    copyFileSync(currentBin, backup);
    try {
      copyFileSync(tmp, currentBin);
      chmodSync(currentBin, 0o755);
      unlinkSync(tmp);
      if (existsSync(backup)) unlinkSync(backup);
    } catch (e) {
      // Restore backup
      if (existsSync(backup)) renameSync(backup, currentBin);
      throw e;
    }
  }
}
