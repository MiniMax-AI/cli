import { defineCommand } from '../command';

const CLI_VERSION = process.env.CLI_VERSION ?? '0.0.0';

export default defineCommand({
  name: 'update',
  description: 'Update minimax to the latest version',
  usage: 'minimax update',
  examples: [
    'minimax update',
  ],
  async run() {
    process.stderr.write(`Current version: ${CLI_VERSION}\n\n`);
    process.stderr.write('Run:\n');
    process.stderr.write('  npm update -g minimax-cli\n\n');
  },
});
