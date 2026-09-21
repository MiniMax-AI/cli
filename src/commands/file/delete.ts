import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { fileDeleteEndpoint } from '../../client/endpoints';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { normalizeFileId } from '../../files/file-id';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { FileDeleteResponse } from '../../types/api';

export default defineCommand({
  name: 'file delete',
  description: 'Delete an uploaded file from MiniMax storage',
  usage: 'mmx file delete --file-id <id>',
  options: [
    { flag: '--file-id <id>', description: 'ID of the file to delete', required: true },
  ],
  examples: [
    'mmx file delete --file-id 123456789',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let fileId = flags.fileId as string | undefined;

    if (!fileId) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        fileId = await promptText({ message: 'Enter file ID to delete:' });
        if (!fileId) {
          process.stderr.write('Delete cancelled.\n');
          process.exit(1);
        }
      } else {
        failIfMissing('file-id', 'mmx file delete --file-id <id>');
      }
    }

    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) {
      throw new CLIError(
        '--file-id must be a positive decimal integer within the int64 range.',
        ExitCode.USAGE,
      );
    }

    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      process.stdout.write(formatOutput({ request: { delete_file: normalizedFileId } }, format) + '\n');
      return;
    }

    const url = fileDeleteEndpoint(config.baseUrl);
    const response = await requestJson<FileDeleteResponse>(config, {
      url,
      method: 'POST',
      body: { file_id: normalizedFileId },
    });

    if (config.quiet) {
      process.stdout.write('deleted\n');
      return;
    }

    process.stdout.write(formatOutput({
      file_id: response.file_id,
      deleted: true,
    }, format) + '\n');
  },
});
