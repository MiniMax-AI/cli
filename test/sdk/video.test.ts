import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { VideoSDK, type VideoAsyncGenerateRequest } from '../../src/sdk/video';

describe('MiniMaxSDK.video', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should generate video async successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/video_generation': () => jsonResponse({
          task_id: 'vid-123',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.generate({
      prompt: 'A cat walking',
      async: true,
    });

    expect(result.taskId).toBe('vid-123');
  });

  it('keeps the legacy V1 request payload unchanged', async () => {
    let requestText = '';
    server = createMockServer({
      routes: {
        'POST /v1/video_generation': async (req) => {
          requestText = await req.text();
          return jsonResponse({
            task_id: 'vid-legacy',
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    await sdk.video.generate({
      model: 'MiniMax-Hailuo-2.3',
      prompt: 'A cat walking',
      first_frame_image: 'https://example.com/first.png',
      callback_url: 'https://example.com/callback',
      async: true,
    });

    expect(requestText).toBe(JSON.stringify({
      model: 'MiniMax-Hailuo-2.3',
      prompt: 'A cat walking',
      first_frame_image: 'https://example.com/first.png',
      callback_url: 'https://example.com/callback',
    }));
  });

  it('should use Video Generation V2 for MiniMax-H3', async () => {
    let requestBody: unknown;
    server = createMockServer({
      routes: {
        '/v2/video_generation': async (req) => {
          requestBody = await req.json();
          return jsonResponse({ task_id: 'h3-123' });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.generate({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'Ocean waves' }],
      async: true,
    });

    expect(result.taskId).toBe('h3-123');
    expect(requestBody).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'Ocean waves' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
  });

  it('should get task status', async () => {
    server = createMockServer({
      routes: {
        '/v1/query/video_generation': () => jsonResponse({
          task_id: 'vid-123',
          status: 'Success',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.getTask({ taskId: 'vid-123' });

    expect(result.status).toBe('Success');
  });

  it('should get MiniMax-H3 task status from Video Generation V2', async () => {
    server = createMockServer({
      routes: {
        '/v2/query/video_generation/h3-123': () => jsonResponse({
          task: {
            id: 'h3-123',
            model: 'MiniMax-H3',
            status: 'succeeded',
            content: { url: 'https://example.com/video.mp4' },
          },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.getTask({ taskId: 'h3-123', model: 'MiniMax-H3' });

    expect(result.status).toBe('succeeded');
  });

  it('should list MiniMax-H3 tasks from Video Generation V2', async () => {
    let requestedUrl = '';
    server = createMockServer({
      routes: {
        '/v2/query/video_generation': (req) => {
          requestedUrl = req.url;
          return jsonResponse({
            items: [{ id: 'h3-123', model: 'MiniMax-H3', status: 'succeeded' }],
            total: 1,
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.listTasks({
      pageNum: 2,
      pageSize: 10,
      status: 'succeeded',
      taskIds: ['h3-123'],
      taskType: 'text_to_video',
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('page_num')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('10');
    expect(url.searchParams.get('filter.status')).toBe('succeeded');
    expect(url.searchParams.get('filter.task_ids')).toBe('h3-123');
    expect(url.searchParams.get('filter.model')).toBe('MiniMax-H3');
    expect(url.searchParams.get('filter.task_type')).toBe('text_to_video');
    expect(result.total).toBe(1);
  });

  it('should delete a MiniMax-H3 task from Video Generation V2', async () => {
    let method = '';
    server = createMockServer({
      routes: {
        '/v2/video_generation/h3-123': (req) => {
          method = req.method;
          return jsonResponse({ task_id: 'h3-123', action: 'delete', status: 'deleted' });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.deleteTask({ taskId: 'h3-123' });

    expect(method).toBe('DELETE');
    expect(result).toEqual({ task_id: 'h3-123', action: 'delete', status: 'deleted' });
  });

  it('should poll a MiniMax-H3 task from running to succeeded', async () => {
    let pollCount = 0;
    server = createMockServer({
      routes: {
        '/v2/video_generation': () => jsonResponse({ task_id: 'h3-sync' }),
        '/v2/query/video_generation/h3-sync': () => {
          pollCount++;
          return jsonResponse({
            task: {
              id: 'h3-sync',
              model: 'MiniMax-H3',
              status: pollCount === 1 ? 'running' : 'succeeded',
              ...(pollCount === 1
                ? {}
                : { content: { url: 'https://example.com/h3-sync.mp4' } }),
            },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.generate({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'Ocean waves' }],
      pollInterval: 0,
    });

    expect(pollCount).toBe(2);
    expect(result).toMatchObject({
      id: 'h3-sync',
      status: 'succeeded',
      content: { url: 'https://example.com/h3-sync.mp4' },
    });
  });

  it('surfaces MiniMax-H3 task failure details while polling', async () => {
    server = createMockServer({
      routes: {
        '/v2/video_generation': () => jsonResponse({ task_id: 'h3-failed' }),
        '/v2/query/video_generation/h3-failed': () => jsonResponse({
          task: {
            id: 'h3-failed',
            model: 'MiniMax-H3',
            status: 'failed',
            error: {
              code: 'H3_FAILED',
              message: 'Reference video could not be decoded',
            },
          },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    await expect(
      sdk.video.generate({
        model: 'MiniMax-H3',
        content: [{ type: 'text', text: 'Ocean waves' }],
        pollInterval: 0,
      }),
    ).rejects.toThrow('H3_FAILED: Reference video could not be decoded');
  });
});

describe('VideoSDK.validateParams', () => {
  const sdk = new VideoSDK({ apiKey: 'sk-test', region: 'global' });

  it('throws when prompt is missing', async () => {
    await expect(
      sdk.generate({} as VideoAsyncGenerateRequest),
    ).rejects.toThrow('prompt is required');
  });

  it('rejects legacy subject_reference for MiniMax-H3 instead of dropping it', async () => {
    await expect(
      sdk.generate({
        model: 'MiniMax-H3',
        prompt: 'Keep the same character',
        subject_reference: [{
          type: 'character',
          image: ['https://example.com/character.png'],
        }],
      }),
    ).rejects.toThrow('Use content with role reference_image');
  });

  it('rejects raw H3 content mixed with legacy request fields', async () => {
    await expect(
      sdk.generate({
        model: 'MiniMax-H3',
        prompt: 'Legacy prompt',
        content: [{ type: 'text', text: 'H3 prompt' }],
      } as never),
    ).rejects.toThrow('content cannot be combined with legacy video fields: prompt');
  });

  it('throws when last_frame_image is provided without first_frame_image', async () => {
    await expect(
      sdk.generate({ prompt: 'test', last_frame_image: 'data:image/png;base64,xxx' }),
    ).rejects.toThrow('last_frame_image requires first_frame_image');
  });

  it('throws when last_frame_image and subject_reference are used together', async () => {
    await expect(
      sdk.generate({
        prompt: 'test',
        first_frame_image: 'data:image/png;base64,xxx',
        last_frame_image: 'data:image/png;base64,yyy',
        subject_reference: [{ type: 'character', image: ['data:image/png;base64,zzz'] }],
      }),
    ).rejects.toThrow('SEF and S2V are different modes');
  });

  it('throws when Fast model used without first_frame_image', async () => {
    await expect(
      sdk.generate({ prompt: 'test', model: 'MiniMax-Hailuo-2.3-Fast' }),
    ).rejects.toThrow('MiniMax-Hailuo-2.3-Fast only supports I2V');
  });

  it('keeps H3-only fields out of the MiniMax-Hailuo-2.3 request path', async () => {
    await expect(
      sdk.generate({
        model: 'MiniMax-Hailuo-2.3',
        prompt: 'test',
        duration: 5,
      } as never),
    ).rejects.toThrow('require model MiniMax-H3');

    await expect(
      sdk.generate({
        model: 'MiniMax-Hailuo-2.3',
        content: [{ type: 'text', text: 'test' }],
        resolution: '2K',
        duration: 5,
        ratio: '16:9',
      } as never),
    ).rejects.toThrow('content is only supported with model MiniMax-H3');
  });

  it('auto-selects SEF model when last_frame_image is provided', async () => {
    // Validation passes → tries network → fails with non-validation error
    await expect(
      sdk.generate({
        prompt: 'test',
        first_frame_image: 'data:image/png;base64,xxx',
        last_frame_image: 'data:image/png;base64,yyy',
      }),
    ).rejects.not.toThrow(/prompt|last_frame/);
  });

  it('auto-selects S2V model when subject_reference is provided', async () => {
    await expect(
      sdk.generate({
        prompt: 'test',
        subject_reference: [{ type: 'character', image: ['data:image/png;base64,zzz'] }],
      }),
    ).rejects.not.toThrow(/prompt|subject/);
  });
});
