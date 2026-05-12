import { defineCommand } from '../../command';
import { clearCredentials, loadCredentials } from '../../auth/credentials';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

export default defineCommand({
  name: 'auth logout',
  description: 'Revoke tokens and clear stored credentials',
  usage: 'mmx auth logout [--yes] [--dry-run]',
  options: [
    { flag: '--yes', description: 'Skip confirmation prompt' },
  ],
  examples: [
    'mmx auth logout',
    'mmx auth logout --dry-run',
    'mmx auth logout --yes',
  ],
  async run(config: Config, _flags: GlobalFlags) {
    const creds = await loadCredentials();
    const fileConfig = readConfigFile();
    const hasConfigKey = !!fileConfig.api_key;

    if (config.dryRun) {
      if (creds) console.log('Would clear oauth from ~/.mmx/config.json');
      if (hasConfigKey) console.log('Would clear api_key from ~/.mmx/config.json');
      if (!creds && !hasConfigKey) console.log('No credentials to clear.');
      console.log('No changes made.');
      return;
    }

    if (!creds && !hasConfigKey) {
      process.stderr.write('No credentials to clear.\n');
      return;
    }

    if (creds) {
      await clearCredentials();
      process.stderr.write('Cleared oauth from ~/.mmx/config.json\n');
    }

    if (hasConfigKey) {
      const updated = readConfigFile() as Record<string, unknown>;
      delete updated.api_key;
      await writeConfigFile(updated);
      process.stderr.write('Cleared api_key from ~/.mmx/config.json\n');
    }
  },
});
