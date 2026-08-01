import type { Config } from '../config/schema';
import { isSecretApiKey } from '../client/endpoints';
import type { AccountBalanceResponse, QuotaResponse } from '../types/api';
import { renderBalanceSummary } from './balance';
import { renderQuotaTable } from './quota-table';

export function renderUsage(
  response: QuotaResponse | AccountBalanceResponse,
  config: Config,
  apiKey?: string,
): void {
  if (apiKey && isSecretApiKey(apiKey)) {
    renderBalanceSummary(response as AccountBalanceResponse, config);
    return;
  }

  renderQuotaTable((response as QuotaResponse).model_remains || [], config);
}
