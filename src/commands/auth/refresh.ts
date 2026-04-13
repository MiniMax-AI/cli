import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { loadCredentials, saveCredentials } from '../../auth/credentials';
import { refreshAccessToken } from '../../auth/refresh';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { CredentialFile } from '../../auth/types';

export default defineCommand({
  name: 'auth refresh',
  description: 'Manually refresh OAuth token',
  usage: 'mmx auth refresh',
  examples: [
    'mmx auth refresh',
  ],
  async run(config: Config, _flags: GlobalFlags) {
    const creds = await loadCredentials();

    if (!creds) {
      throw new CLIError(
        'Not applicable: not authenticated via OAuth.',
        ExitCode.USAGE,
        'Run mmx auth login first.',
      );
    }

    if (config.dryRun) {
      console.log('Would refresh OAuth token.');
      return;
    }

    const tokens = await refreshAccessToken(
      creds.refresh_token,
      `${config.oauthApiHost}/oauth2/token`,
    );

    const updated: CredentialFile = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(tokens.expired_in).toISOString(), // expired_in is Unix timestamp (ms)
      token_type: 'Bearer',
      resource_url: tokens.resource_url ?? creds.resource_url,
      account: creds.account,
    };

    await saveCredentials(updated);

    const format = detectOutputFormat(config.output);

    if (config.quiet) {
      console.log(updated.expires_at);
      return;
    }

    console.log(formatOutput({
      status: 'Token refreshed',
      expires: updated.expires_at,
    }, format));
  },
});
