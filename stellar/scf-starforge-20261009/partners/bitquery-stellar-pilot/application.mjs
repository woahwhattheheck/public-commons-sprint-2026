// MIT. Exports for the original serve.mjs --handlers interface; no separate HTTP runtime.
import { loadRelease } from './merchant.mjs';
if (!process.env.SF30_BITQUERY_RELEASE) throw new TypeError('Set the private derived release directory');
const {datasets} = await loadRelease(process.env.SF30_BITQUERY_RELEASE);
export const queryLedger = datasets.ledger_activity.handle;
export const admitLedger = datasets.ledger_activity.admit;
export const queryPayments = datasets.payment_flows.handle;
export const admitPayments = datasets.payment_flows.admit;
export const queryBalances = datasets.balance_changes.handle;
export const admitBalances = datasets.balance_changes.admit;
