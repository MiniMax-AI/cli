import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

const VERSION = process.env.VERSION ?? 'dev';
const OUT = 'dist/minimax.mjs';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

console.log(`Building minimax-cli ${VERSION}...`);

await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  naming: 'minimax.mjs',
  target: 'node',
  minify: true,
  define: { 'process.env.CLI_VERSION': JSON.stringify(VERSION) },
});

// Prepend shebang
const content = readFileSync(OUT);
writeFileSync(OUT, Buffer.concat([Buffer.from('#!/usr/bin/env node\n'), content]));

writeFileSync('dist/manifest.json', JSON.stringify({ version: VERSION, checksum: sha256(OUT) }, null, 2));
console.log(`Done. dist/minimax.mjs  ${(content.length / 1024).toFixed(0)}KB`);
