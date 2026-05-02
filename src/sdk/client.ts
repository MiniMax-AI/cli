import { loadConfig } from "../config/loader";
import { Config, Region } from "../config/schema";
import { request as requestClient, requestJson as requestJsonClient, RequestOpts } from "../client/http";
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
}
