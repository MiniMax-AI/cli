import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const VERSION = process.env.VERSION ?? pkg.version;
const OUT = 'dist/mmx.mjs';
const DEV_BUILD = process.argv.includes('--dev');

await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  naming: 'mmx.mjs',
  target: 'node',
  minify: !DEV_BUILD,
  define: { 'process.env.CLI_VERSION': JSON.stringify(VERSION) },
});

const content = readFileSync(OUT);
writeFileSync(OUT, Buffer.concat([Buffer.from('#!/usr/bin/env node\n'), content]));

const size = (content.length / 1024).toFixed(0);
console.log(`dist/mmx.mjs  ${size}KB`);
