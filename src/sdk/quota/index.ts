import { Client } from "../client";
import { selectUsageEndpoint } from "../../client/endpoints";
import { resolveCredential } from "../../auth/resolver";
import type { AccountBalanceResponse, QuotaResponse } from "../../types/api";

export type QuotaInfoResponse = QuotaResponse | AccountBalanceResponse;

export function isQuotaResponse(response: QuotaInfoResponse): response is QuotaResponse {
  return 'model_remains' in response;
}

export function isAccountBalanceResponse(
  response: QuotaInfoResponse,
): response is AccountBalanceResponse {
  return 'available_amount' in response;
}

export class QuotaSDK extends Client {
  async info(): Promise<QuotaInfoResponse> {
    const credential = await resolveCredential(this.config);
    const endpoint = selectUsageEndpoint(this.config.baseUrl, credential);

    if (endpoint.kind === 'account-balance') {
      return this.requestJson<AccountBalanceResponse>({ url: endpoint.url });
    }

    return this.requestJson<QuotaResponse>({ url: endpoint.url });
  }
}

export type { AccountBalanceResponse, QuotaResponse } from "../../types/api";
