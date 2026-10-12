import type {
  CancelPaymentRequestInput, CreatePaymentRequestInput, DateOnly, PaymentRequestDetail,
  PaymentRequestFileName, PaymentRequestInput, PaymentRequestMutationResult, PaymentRequestPage,
  PaymentRequestPreview, PaymentRequestProposal, PaymentRequestQuery, PaymentRequestSummary,
  PaymentReturn, PaymentTransferVerification, ReceivePaymentRequestInput, ReturnedPaymentInput,
} from './client.js';
import type {PaymentReceivablesData} from './payment-requests.js';
export type PaymentTransferVerifier = (input: {
  request: PaymentRequestProposal; returned: PaymentReturn;
}) => Promise<PaymentTransferVerification>;
export interface PaymentRequestsWorkspaceOptions { verifyTransfer?: PaymentTransferVerifier }
export interface PaymentWorkspaceFile { bytes: Uint8Array; name: string; type: string }
/** Uses the existing ReceivablesWorkspace lease, journal and receipt register. */
export class PaymentRequestsWorkspace {
  constructor(receivables: object, options?: PaymentRequestsWorkspaceOptions);
  receivables: object; workspace: unknown; verifyTransfer?: PaymentTransferVerifier;
  data(): PaymentReceivablesData;
  summaries(data?: PaymentReceivablesData, asOf?: DateOnly): PaymentRequestSummary[];
  summary(id: string, data?: PaymentReceivablesData, asOf?: DateOnly): PaymentRequestSummary;
  preview(invoiceId: string, value: PaymentRequestInput): Promise<PaymentRequestPreview>;
  create(invoiceId: string, value: CreatePaymentRequestInput): Promise<PaymentRequestMutationResult>;
  list(query?: PaymentRequestQuery): Promise<PaymentRequestPage>;
  detail(id: string, query?: {asOf?: DateOnly}): Promise<PaymentRequestDetail>;
  cancel(id: string, value: CancelPaymentRequestInput): Promise<PaymentRequestMutationResult>;
  reportReturn(id: string, value: ReturnedPaymentInput): Promise<PaymentRequestMutationResult & {paymentReturn: PaymentReturn}>;
  receive(id: string, value: ReceivePaymentRequestInput): Promise<PaymentRequestMutationResult & {paymentReturn: PaymentReturn}>;
  file(id: string, name: PaymentRequestFileName): Promise<PaymentWorkspaceFile>;
}
