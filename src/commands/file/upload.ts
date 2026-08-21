import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { resolveFileUploadPath, uploadFile } from '../../files/upload';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { FileUploadResponse } from '../../types/api';

export default defineCommand({
  name: 'file upload',
  description: 'Upload a file to MiniMax storage',
  usage: 'mmx file upload --file <path> [--purpose <purpose>]',
  options: [
    { flag: '--file <path>', description: 'Local path to the file', required: true },
    { flag: '--purpose <string>', description: 'File purpose (default: retrieval)' },
  ],
  examples: [
    'mmx file upload --file doc.pdf',
    'mmx file upload --file image.png --purpose vision',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let filePath = flags.file as string | undefined;

    if (!filePath) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        filePath = await promptText({ message: 'Enter file path:' });
        if (!filePath) {
          process.stderr.write('Upload cancelled.\n');
          process.exit(1);
        }
      } else {
        failIfMissing('file', 'mmx file upload --file <path>');
      }
    }

    const createFileNotFoundError = (fullPath: string) =>
      new CLIError(`File not found: ${fullPath}`, ExitCode.USAGE);
    const fullPath = resolveFileUploadPath(filePath, createFileNotFoundError);

    const purpose = (flags.purpose as string) || 'retrieval';
    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      process.stdout.write(formatOutput({ request: { file: fullPath, purpose } }, format) + '\n');
      return;
    }

    const response = await uploadFile({
      filePath: fullPath,
      purpose,
      baseUrl: config.baseUrl,
      requestJson: (opts) => requestJson<FileUploadResponse>(config, opts),
      createFileNotFoundError,
    });

    if (config.quiet) {
      process.stdout.write(response.file.file_id + '\n');
      return;
    }

    process.stdout.write(formatOutput(response.file, format) + '\n');
  },
});
