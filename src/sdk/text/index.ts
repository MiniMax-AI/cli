import { Client } from "../client";
import { chatEndpoint } from "../../client/endpoints";
import { ChatRequest, ChatResponse, StreamEvent } from "../../types/api";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { TEXT_MODELS, textModel } from "../../commands/text/models";

export class TextSDK extends Client {
  private async *chatStream(body: Partial<ChatRequest>): AsyncGenerator<StreamEvent> {
    const url = chatEndpoint(this.config.baseUrl);

    const res = await this.request({
      url,
      method: 'POST',
      body,
      stream: true,
      authStyle: 'x-api-key',
    });

    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('text/event-stream') && !contentType.includes('stream')) {
      throw new SDKError(
        `Expected SSE stream but got content-type "${contentType}". Server may be experiencing issues.`,
        ExitCode.GENERAL,
      );
    }

    yield* this.streamSSE<StreamEvent>(res);
  }

  async chat(request: Partial<ChatRequest> & { stream: true }): Promise<AsyncGenerator<StreamEvent>>;
  async chat(request: Partial<ChatRequest>): Promise<ChatResponse>;
  async chat(request: Partial<ChatRequest>): Promise<ChatResponse | AsyncGenerator<StreamEvent>> {
    const body = this.validateParams(request);
    const url = chatEndpoint(this.config.baseUrl);

    if (body.stream) {
      return this.chatStream(body);
    }

    return await this.requestJson<ChatResponse>({
      url,
      method: 'POST',
      body,
      authStyle: 'x-api-key',
    });
  }

  private validateParams(params: Partial<ChatRequest>): ChatRequest {
    if (params.messages?.length === 0) {
      throw new SDKError(
        'At least one message is required.',
        ExitCode.USAGE,
      );
    }

    const model = textModel(this.config, params.model);
    if (params.model && !TEXT_MODELS.includes(model as typeof TEXT_MODELS[number])) {
      throw new SDKError(
        `Invalid model "${model}". Valid models: ${TEXT_MODELS.join(', ')}`,
        ExitCode.USAGE,
      );
    }

    return {
      ...params,
      model,
      max_tokens: params.max_tokens ?? 4096,
    } as ChatRequest;
  }
}
