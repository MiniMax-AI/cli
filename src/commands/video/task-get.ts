import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { videoTaskEndpoint, videoTaskV2Endpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VideoTaskResponse, VideoV2TaskResponse } from '../../types/api';
import { isVideoV2Model } from '../../video/v2';

export default defineCommand({
  name: 'video task get',
  description: 'Query video task status',
  usage: 'mmx video task get --task-id <id>',
  options: [
    { flag: '--task-id <id>', description: 'Video generation task ID' },
    { flag: '--model <model>', description: 'Use MiniMax-H3 for Video Generation V2 tasks; defaults to the legacy V1 query.' },
  ],
  examples: [
    'mmx video task get --task-id 106916112212032',
    'mmx video task get --task-id 106916112212032 --output json',
    'mmx video task get --task-id 424010985738629 --model MiniMax-H3 --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const taskId = flags.taskId as string | undefined;
    if (!taskId) {
      throw new CLIError(
        '--task-id is required.',
        ExitCode.USAGE,
        'mmx video task get --task-id <id>',
      );
    }

    if (config.dryRun) {
      console.log(`Would query task: ${taskId}`);
      return;
    }

    const format = detectOutputFormat(config.output);
    const model = flags.model as string | undefined;

    if (isVideoV2Model(model)) {
      const url = videoTaskV2Endpoint(config.baseUrl, taskId);
      const response = await requestJson<VideoV2TaskResponse>(config, { url });
      const task = response.task;

      if (config.quiet) {
        console.log(task.status);
        return;
      }

      console.log(formatOutput({
        task_id: task.id,
        model: task.model,
        status: task.status,
        url: task.content?.url,
        resolution: task.resolution,
        duration: task.duration,
        ratio: task.ratio,
        error: task.error,
      }, format));
      return;
    }

    const url = videoTaskEndpoint(config.baseUrl, taskId);
    const response = await requestJson<VideoTaskResponse>(config, { url });

    if (config.quiet) {
      console.log(response.status);
      return;
    }

    console.log(formatOutput({
      task_id: response.task_id,
      status: response.status,
      file_id: response.file_id,
      video_width: response.video_width,
      video_height: response.video_height,
    }, format));
  },
});
