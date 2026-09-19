import { Client } from "../client";
import { chatEndpoint } from "../../client/endpoints";
import { ChatRequest, ChatResponse, StreamEvent } from "../../types/api";
import { SDKError } from "../../errors/base";
import { ExitCode } from "../../errors/codes";
import { resolveMaxTokens } from "../../utils/model-defaults";

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

    const model = params.model ?? 'MiniMax-M3';

    const body: ChatRequest = {
      ...params,
      model,
      max_tokens: resolveMaxTokens(model, params.max_tokens),
    } as ChatRequest;

    // Pass thinking through only if explicitly provided; never auto-inject.
    // Per Messages API contract, thinking is disabled by default when omitted.
    if (params.thinking !== undefined) {
      body.thinking = params.thinking;
    } else {
      delete body.thinking;
    }

    return body;
  }
}
