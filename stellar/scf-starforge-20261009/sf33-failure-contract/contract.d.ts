export type Stage='verify'|'settle'|'discovery'|'mcp'|'wallet';
export type RecoveryAction='stop'|'requote_and_reauthorize'|'reauthorize'|'check_account'|'change_route'|'retry_read'|'reconcile_settlement'|'request_approval';
export declare const VERSION:string;
export declare const STAGES:ReadonlyArray<Stage>;
export declare const ACTIONS:Readonly<Record<string,RecoveryAction>>;
export interface FailureEnvelope {readonly version:string;readonly code:string;readonly reason:string;readonly stage:Stage;readonly traceId:string;readonly recoveryAction:RecoveryAction;readonly safeToAutoRetry:boolean;readonly requiresNewPaymentAuthorization:boolean;readonly settlementMayBePending:boolean;readonly settlement:Readonly<{transaction:string|null;network:string|null;confirmed:false}>|null;readonly retryAfterMs?:number}
export interface RecoveryDecision {readonly decision:'already_settled'|'reconcile_before_any_new_payment'|'prepare_new_authorization'|'await_user_authorization'|'retry_read_only_operation'|'stop_or_request_user_action';readonly maySubmitPayment:false;readonly requiresManualReview:boolean}
export declare function explainFailure(input:{stage:Stage;reason?:string;response?:Record<string,unknown>|null;traceId?:string;retryAfterMs?:number}):Readonly<FailureEnvelope>;
export declare function gateNextAction(failure:FailureEnvelope,options?:{ledgerReceipt?:{confirmed:boolean;success:boolean;transaction:string;network:string}|null;explicitNewAuthorization?:boolean}):Readonly<RecoveryDecision>;
