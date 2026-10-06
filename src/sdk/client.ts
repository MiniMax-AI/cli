import { loadConfig } from "../config/loader";
import { Config } from "../config/schema";
import { request as requestClient, requestJson as requestJsonClient, RequestOpts } from "../client/http";
import { parseSSE } from "../client/stream";
import { SDKError } from "../errors/base";
import { ExitCode } from "../errors/codes";
import { MiniMaxSDKOptions } from "./types";

export class Client {
  protected config: Config;

  constructor(options: MiniMaxSDKOptions) {
    const { apiKey, region, baseUrl } = options;
    this.config = loadConfig({
      apiKey,
      baseUrl,
      region,
      quiet: true,
      verbose: false,
      noColor: true,
      yes: false,
      dryRun: false,
      help: false,
      nonInteractive: false,
      async: false,
    });
  }

  protected request(opts: RequestOpts) {
    return requestClient(this.config, opts);
  }

  protected requestJson<T>(opts: RequestOpts): Promise<T> {
    return requestJsonClient<T>(this.config, opts);
  }

  protected async *streamSSE<T>(res: Response): AsyncGenerator<T> {
    try {
      for await (const event of parseSSE(res)) {
        if (event.data === '[DONE]') break;
        if (!event.data) continue;
        try {
          yield JSON.parse(event.data) as T;
        } catch (err) {
          throw new SDKError(
            `Failed to parse stream chunk: ${err instanceof Error ? err.message : String(err)}`,
            ExitCode.GENERAL,
          );
        }
      }
    } finally {
      // parseSSE releases its reader; the SDK also owns the response body.
      await res.body?.cancel().catch(() => undefined);
    }
  }
}
