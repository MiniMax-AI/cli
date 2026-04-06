import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { fileUploadEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { FileUploadResponse } from '../../types/api';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';

export default defineCommand({
  name: 'file upload',
  description: 'Upload a file to MiniMax storage',
  usage: 'minimax file upload --file <path> [--purpose <purpose>]',
  options: [
    { flag: '--file <path>', description: 'Local path to the file', required: true },
    { flag: '--purpose <string>', description: 'File purpose (default: retrieval)' },
  ],
  examples: [
    'minimax file upload --file doc.pdf',
    'minimax file upload --file image.png --purpose vision',
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
        failIfMissing('file', 'minimax file upload --file <path>');
      }
    }

    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) {
      throw new CLIError(`File not found: ${fullPath}`, ExitCode.USAGE);
    }

    const purpose = (flags.purpose as string) || 'retrieval';
    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      process.stdout.write(formatOutput({ request: { file: fullPath, purpose } }, format) + '\n');
      return;
    }

    const formData = new FormData();
    // Read file using Node.js fs/promises (compatible with both Node and Bun)
    const fileData = await readFile(fullPath);
    const fileName = basename(fullPath);
    const fileBlob = new Blob([fileData]);
    formData.append('file', fileBlob, fileName);
    formData.append('purpose', purpose);

    const url = fileUploadEndpoint(config.baseUrl);
    const response = await requestJson<FileUploadResponse>(config, {
      url,
      method: 'POST',
      body: formData,
    });

    if (config.quiet) {
      process.stdout.write(response.file.file_id + '\n');
      return;
    }

    process.stdout.write(formatOutput(response.file, format) + '\n');
  },
});
