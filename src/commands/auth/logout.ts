import { defineCommand } from '../../command';
import { clearCredentials, loadCredentials } from '../../auth/credentials';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

export default defineCommand({
  name: 'auth logout',
  description: 'Revoke tokens and clear stored credentials',
  usage: 'minimax auth logout [--yes] [--dry-run]',
  options: [
    { flag: '--yes', description: 'Skip confirmation prompt' },
  ],
  examples: [
    'minimax auth logout',
    'minimax auth logout --dry-run',
    'minimax auth logout --yes',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const creds = await loadCredentials();
    const fileConfig = readConfigFile();
    const hasConfigKey = !!fileConfig.api_key;

    if (config.dryRun) {
      if (creds) console.log('Would remove ~/.minimax/credentials.json');
      if (hasConfigKey) console.log('Would clear api_key from ~/.minimax/config.json');
      if (!creds && !hasConfigKey) console.log('No credentials to clear.');
      console.log('No changes made.');
      return;
    }

    if (creds) {
      await clearCredentials();
      process.stderr.write('Removed ~/.minimax/credentials.json\n');
    }

    if (hasConfigKey) {
      try {
        const updated = fileConfig as Record<string, unknown>;
        delete updated.api_key;
        await writeConfigFile(updated);
        process.stderr.write('Cleared api_key from ~/.minimax/config.json\n');
      } catch { /* ignore */ }
    }

    if (!creds && !hasConfigKey) {
      process.stderr.write('No credentials to clear.\n');
    }
  },
});
