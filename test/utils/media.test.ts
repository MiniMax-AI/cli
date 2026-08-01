import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveImageInput } from '../../src/utils/image';
import {
  dataUriDecodedSize,
  resolveMediaInput,
  VIDEO_V2_MEDIA_SIZE_LIMITS,
} from '../../src/utils/media';

describe('H3 media limits', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calculates decoded Base64 data URI size', () => {
    expect(dataUriDecodedSize('data:audio/wav;base64,QUJDRA==')).toBe(4);
    expect(dataUriDecodedSize('https://example.com/audio.wav')).toBeUndefined();
  });

  it('uses the H3-compatible MP3 data URI format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-mp3-'));
    tempDirs.push(dir);
    const file = join(dir, 'reference.mp3');
    writeFileSync(file, 'mp3-data');

    expect(resolveMediaInput(file, 'audio')).toStartWith('data:audio/mp3;base64,');
    expect(resolveMediaInput('data:audio/mpeg;base64,bXAz', 'audio'))
      .toBe('data:audio/mp3;base64,bXAz');
  });

  it('encodes supported local MOV reference videos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-mov-'));
    tempDirs.push(dir);
    const file = join(dir, 'reference.mov');
    writeFileSync(file, 'mov-data');

    expect(resolveMediaInput(file, 'video')).toStartWith('data:video/quicktime;base64,');
  });

  it('rejects oversized local reference audio before reading it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-audio-'));
    tempDirs.push(dir);
    const file = join(dir, 'audio.wav');
    writeFileSync(file, '');
    truncateSync(file, VIDEO_V2_MEDIA_SIZE_LIMITS.audio + 1);

    expect(() => resolveMediaInput(file, 'audio')).toThrow('allows at most 15 MB');
  });

  it('applies the H3 image limit only when requested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-image-'));
    tempDirs.push(dir);
    const file = join(dir, 'image.png');
    writeFileSync(file, '');
    truncateSync(file, VIDEO_V2_MEDIA_SIZE_LIMITS.image + 1);

    expect(() => resolveImageInput(file, VIDEO_V2_MEDIA_SIZE_LIMITS.image)).toThrow('allows at most 30 MB');
  });
});
