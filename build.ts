import { readFileSync, writeFileSync } from 'fs';
import dts from 'bun-plugin-dts';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const VERSION = process.env.VERSION ?? pkg.version;
const OUT = 'dist/mmx.mjs';
const SDK_OUT = 'dist/sdk.mjs';

await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  naming: 'mmx.mjs',
  target: 'node',
  minify: true,
  define: { 'process.env.CLI_VERSION': JSON.stringify(VERSION) },
});

const content = readFileSync(OUT);
writeFileSync(OUT, Buffer.concat([Buffer.from('#!/usr/bin/env node\n'), content]));

const size = (content.length / 1024).toFixed(0);
console.log(`dist/mmx.mjs  ${size}KB`);

await Bun.build({
  entrypoints: ['src/sdk/index.ts'],
  outdir: 'dist',
  naming: 'sdk.mjs',
  target: 'node',
  minify: false,
  plugins: [dts()],
});

const sdkContent = readFileSync(SDK_OUT);
const sdkSize = (sdkContent.length / 1024).toFixed(0);
console.log(`dist/sdk.mjs  ${sdkSize}KB`);
