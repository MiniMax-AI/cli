import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { videoTaskV2ListEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VideoV2TaskListResponse } from '../../types/api';
import { VIDEO_V2_MODEL } from '../../video/v2';

export default defineCommand({
  name: 'video task list',
  description: 'List Video Generation V2 tasks',
  apiDocs: '/docs/api-reference/video-generation-v2-list',
  usage: 'mmx video task list [flags]',
  options: [
    { flag: '--page-num <number>', description: 'Page number to request', type: 'number' },
    { flag: '--page-size <number>', description: 'Page size to request', type: 'number' },
    { flag: '--status <status>', description: 'Filter by task status' },
    { flag: '--task-id <id>', description: 'Filter by task ID; repeatable', type: 'array' },
    { flag: '--task-type <type>', description: 'Filter by task type' },
  ],
  examples: [
    'mmx video task list --output json',
    'mmx video task list --status succeeded --page-size 20',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const format = detectOutputFormat(config.output);
    const url = new URL(videoTaskV2ListEndpoint(config.baseUrl));

    if (flags.pageNum !== undefined) url.searchParams.set('page_num', String(flags.pageNum));
    if (flags.pageSize !== undefined) url.searchParams.set('page_size', String(flags.pageSize));
    if (flags.status) url.searchParams.set('filter.status', String(flags.status));
    const taskIds = flags.taskId as string[] | undefined;
    if (taskIds?.length) url.searchParams.set('filter.task_ids', taskIds.join(','));
    url.searchParams.set('filter.model', VIDEO_V2_MODEL);
    if (flags.taskType) url.searchParams.set('filter.task_type', String(flags.taskType));

    if (config.dryRun) {
      process.stdout.write(formatOutput({ request: { url: url.toString() } }, format) + '\n');
      return;
    }

    const response = await requestJson<VideoV2TaskListResponse>(config, { url: url.toString() });

    if (format !== 'text') {
      process.stdout.write(formatOutput(response, format) + '\n');
      return;
    }

    if (!response.items || response.items.length === 0) {
      process.stdout.write('No video tasks found.\n');
      return;
    }

    const tableData = response.items.map(task => ({
      ID: task.id,
      MODEL: task.model,
      STATUS: task.status,
      RESOLUTION: task.resolution ?? '',
      DURATION: task.duration ?? '',
    }));

    const { formatTable } = await import('../../output/text');
    process.stdout.write(formatTable(tableData) + '\n');
  },
});
