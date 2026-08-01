import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { videoTaskV2DeleteEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VideoV2TaskDeleteResponse } from '../../types/api';

export default defineCommand({
  name: 'video task delete',
  description: 'Delete a Video Generation V2 task',
  apiDocs: '/docs/api-reference/video-generation-v2-delete',
  usage: 'mmx video task delete --task-id <id>',
  options: [
    { flag: '--task-id <id>', description: 'Video Generation V2 task ID', required: true },
  ],
  examples: [
    'mmx video task delete --task-id 424010985738629',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const taskId = flags.taskId as string | undefined;
    if (!taskId) {
      throw new CLIError(
        '--task-id is required.',
        ExitCode.USAGE,
        'mmx video task delete --task-id <id>',
      );
    }

    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      process.stdout.write(formatOutput({ request: { delete_video_task: taskId } }, format) + '\n');
      return;
    }

    const url = videoTaskV2DeleteEndpoint(config.baseUrl, taskId);
    const response = await requestJson<VideoV2TaskDeleteResponse>(config, {
      url,
      method: 'DELETE',
    });

    if (config.quiet) {
      process.stdout.write(`${response.status}\n`);
      return;
    }

    process.stdout.write(formatOutput(response, format) + '\n');
  },
});
