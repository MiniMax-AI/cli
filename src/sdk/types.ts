import { Region } from "../config/schema";

export interface MiniMaxSDKOptions {
  apiKey?: string;
  baseUrl?: string;
  region?: Region;
}

export type ModelPartial<T> = 'model' extends keyof T
  ? Omit<T, 'model'> & { model?: T['model'] }
  : T;
