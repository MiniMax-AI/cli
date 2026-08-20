import { defineCommand } from '../command';
import { DOCS_HOSTS } from '../config/schema';
import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';

interface ApiRef {
  command: string;
  title: string;
  path: string;
}

const API_REFS: ApiRef[] = [
  { command: 'mmx text chat',            title: 'Text Generation (Chat Completion)',    path: '/docs/api-reference/text-post' },
  { command: 'mmx speech synthesize',    title: 'Speech T2A (Text-to-Audio)',           path: '/docs/api-reference/speech-t2a-http' },
  { command: 'mmx image generate',       title: 'Image Generation (T2I / I2I)',         path: '/docs/api-reference/image-generation-t2i' },
  { command: 'mmx video generate',       title: 'Video Generation (T2V / I2V / S2V)',   path: '/docs/api-reference/video-generation' },
  { command: 'mmx search query',         title: 'Web Search',                           path: '/docs/api-reference/web-search' },
  { command: 'mmx vision describe',      title: 'Vision (Image Understanding)',         path: '/docs/api-reference/vision' },
];

export default defineCommand({
  name: 'help',
  description: 'Show MiniMax API documentation links',
  usage: 'mmx help',
  async run(config: Config, _flags: GlobalFlags) {
    const host = DOCS_HOSTS[config.region] || DOCS_HOSTS.global;
    process.stdout.write(`
MiniMax API Documentation Links

  Official docs: ${host}/docs/api-reference

`);
    for (const ref of API_REFS) {
      process.stdout.write(`  ${ref.command.padEnd(30)} ${ref.title}\n`);
      process.stdout.write(`  ${' '.repeat(30)} ${host}${ref.path}\n\n`);
    }
  },
});
