import type {PaymentRequestProposal, PaymentReturn, PaymentTransferVerification} from './client.js';
import type {PaymentTransferVerifier} from './payment-requests-workspace.js';
export type InvoiceStellarSdk = typeof import('@stellar/stellar-sdk');
export interface InvoiceTransferVerifierOptions {
  fetchImpl?: typeof fetch; rpcEndpoint?: string; sdk?: InvoiceStellarSdk; signal?: AbortSignal;
}
export interface InvoiceTransferVerificationInput extends InvoiceTransferVerifierOptions {
  request: PaymentRequestProposal; returned: PaymentReturn;
}
export function loadInvoiceStellarSdk(): Promise<InvoiceStellarSdk>;
/** Decode the original ledger response against the saved collection terms. */
export function decodeInvoiceStellarTransfer(input: {
  request: PaymentRequestProposal; returned: PaymentReturn;
  transactionResponse: Record<string, unknown>; sdk?: InvoiceStellarSdk;
}): Promise<Record<string, unknown>>;
export function verifyInvoiceStellarTransfer(input: InvoiceTransferVerificationInput): Promise<PaymentTransferVerification>;
export function createInvoiceTransferVerifier(options?: InvoiceTransferVerifierOptions): PaymentTransferVerifier;
