import { readFileSync, writeFileSync } from 'fs';

const VERSION = process.env.VERSION ?? 'dev';
const OUT = 'dist/minimax.mjs';

await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  naming: 'minimax.mjs',
  target: 'node',
  minify: true,
  define: { 'process.env.CLI_VERSION': JSON.stringify(VERSION) },
});

const content = readFileSync(OUT);
writeFileSync(OUT, Buffer.concat([Buffer.from('#!/usr/bin/env node\n'), content]));

const size = (content.length / 1024).toFixed(0);
console.log(`dist/minimax.mjs  ${size}KB`);
