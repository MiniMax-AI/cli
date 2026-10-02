import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFile } from '../../src/files/download';
import { CLIError } from '../../src/errors/base';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-download-ssrf-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('media download SSRF and security controls', () => {
  it('rejects download URLs targeting loopback IP addresses', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'output.mp4');

    await expect(downloadFile('http://127.0.0.1:8080/video.mp4', dest, { quiet: true }))
      .rejects.toThrow(CLIError);
    await expect(downloadFile('http://127.0.0.1:8080/video.mp4', dest, { quiet: true }))
      .rejects.toThrow(/SSRF protection/);
  });

  it('rejects download URLs targeting localhost', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'output.mp4');

    await expect(downloadFile('http://localhost:9000/video.mp4', dest, { quiet: true }))
      .rejects.toThrow(/SSRF protection/);
  });

  it('rejects download URLs targeting cloud metadata service (169.254.169.254)', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'output.mp4');

    await expect(downloadFile('http://169.254.169.254/latest/meta-data', dest, { quiet: true }))
      .rejects.toThrow(/SSRF protection/);
  });

  it('rejects download URLs targeting private RFC 1918 networks', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'output.mp4');

    await expect(downloadFile('http://10.200.1.1/video.mp4', dest, { quiet: true }))
      .rejects.toThrow(/SSRF protection/);
    await expect(downloadFile('http://192.168.0.10/video.mp4', dest, { quiet: true }))
      .rejects.toThrow(/SSRF protection/);
  });

  it('permits private destination when allowPrivate is explicitly true', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'output.mp4');

    globalThis.fetch = (async () => new Response('video-bytes', {
      status: 200,
      headers: { 'content-length': '11' },
    })) as unknown as typeof fetch;

    const result = await downloadFile('http://127.0.0.1:8080/video.mp4', dest, {
      quiet: true,
      allowPrivate: true,
    });

    expect(result.size).toBe(11);
  });
});
