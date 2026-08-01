import type { Config } from '../config/schema';
import type { AccountBalanceResponse } from '../types/api';

function formatFlag(value: boolean): string {
  return value ? 'on' : 'off';
}

export function renderBalanceSummary(balance: AccountBalanceResponse, _config: Config): void {
  console.log('Account Balance:');
  console.log(`  Available: ${balance.available_amount}`);
  console.log(`  Cash:      ${balance.cash_balance}`);
  console.log(`  Voucher:   ${balance.voucher_balance}`);
  console.log(`  Credit:    ${balance.credit_balance}`);
  console.log(`  Owed:      ${balance.owed_amount}`);
  console.log(`  Alert:     ${formatFlag(balance.balance_alert_switch)}`);
  if (balance.balance_alert_threshold) {
    console.log(`  Threshold: ${balance.balance_alert_threshold}`);
  }
}
