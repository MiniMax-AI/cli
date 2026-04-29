import { defineCommand } from '../command';
import { CLI_VERSION } from '../version';

export default defineCommand({
  name: 'update',
  description: 'Update mmx to the latest version',
  usage: 'mmx update',
  examples: [
    'mmx update',
  ],
  async run() {
    process.stderr.write(`Current version: ${CLI_VERSION}\n\n`);
    process.stderr.write('Run:\n');
    process.stderr.write('  npm update -g mmx-cli\n\n');
  },
});
