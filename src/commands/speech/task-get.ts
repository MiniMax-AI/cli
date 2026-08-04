import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { speechAsyncQueryEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { SpeechAsyncQueryResponse } from '../../types/api';

export default defineCommand({
  name: 'speech task get',
  description: 'Query an asynchronous TTS task status',
  apiDocs: '/docs/api-reference/speech-t2a-async-query',
  usage: 'mmx speech task get --task-id <id>',
  options: [
    { flag: '--task-id <id>', description: 'Asynchronous TTS task ID' },
  ],
  examples: [
    'mmx speech task get --task-id 95157322514444',
    'mmx speech task get --task-id 95157322514444 --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const taskId = flags.taskId as string | undefined;
    if (!taskId) {
      throw new CLIError(
        '--task-id is required.',
        ExitCode.USAGE,
        'mmx speech task get --task-id <id>',
      );
    }

    if (config.dryRun) {
      console.log(`Would query task: ${taskId}`);
      return;
    }

    const format = detectOutputFormat(config.output);
    const url = speechAsyncQueryEndpoint(config.baseUrl, taskId);
    const response = await requestJson<SpeechAsyncQueryResponse>(config, { url });

    if (config.quiet) {
      console.log(response.status);
      return;
    }

    console.log(formatOutput({
      task_id: response.task_id,
      status: response.status,
      file_id: response.file_id,
    }, format));
  },
});
