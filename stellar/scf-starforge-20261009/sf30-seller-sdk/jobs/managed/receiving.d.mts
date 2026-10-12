import type {JobSourceIdentity, JobServiceLanding, JobServiceExit} from './index.mjs';
export interface JobMerchantApplicationSettings {
  stateDirectory: string; configurationFile: string;
  nativeFactoryFile?: string; intakeConfigurationFile?: string;
  deliveryConfigurationFile?: string; deliveryDirectory?: string; environmentFile?: string;
  sellerPort?: number; customerPort?: number; operationsPort?: number; port?: number;
  startWorker?: false; startDelivery?: false; landing?: JobServiceLanding;
}
export interface JobMerchantApplicationReceivingInput {
  schema: 'stellar-forge.job-merchant-applications-receiving.v1';
  runtimeWorkspace: string; runtimeId: string; settings: JobMerchantApplicationSettings;
  jobIds: string[]; recordDirectory: string; label: string; timeoutMs?: number;
}
export interface JobMerchantReceivingFile {path: string; bytes: number; sha256: string}
export interface ReceivedMerchantJob {
  id: string; functionId: string; inputSha256: string; nativeSettlement: {id: string; at: string};
  result: {bytes: number; sha256: string; contentType: string; filename: string};
}
export interface ReceivedMerchantLaunch {
  instanceId: string; pid: number; directory: string; configPath: string; runtimeDirectory: string;
  source: JobSourceIdentity; selectionSha256: string; mode: string; origin: string;
  landing: JobServiceLanding; capabilities: {inputs: true; resolution: true; delivery: boolean};
}
export interface JobMerchantApplicationReceived {
  schema: 'stellar-forge.job-merchant-applications-received.v1'; state: 'COMPLETE'; inputSha256: string;
  applicationId: string; applicationRevision: string; runtimeWorkspace: string; runtimeId: string;
  merchant: {directory: string; configPath: string; source: JobSourceIdentity};
  completedJobs: ReceivedMerchantJob[];
  starts: Array<{operationId: string; selectionSha256: string; launch: ReceivedMerchantLaunch;
    pages: Array<{path: string; bytes: number; sha256: string}>; ledger: JobMerchantReceivingFile; exit: JobServiceExit}>;
  receiving: {directory: string; plan: string; result: string}; completedAt: string;
}
export const RECEIVING_SCHEMA: 'stellar-forge.job-merchant-applications-receiving.v1';
export function receiveJobMerchantApplication(
  input: JobMerchantApplicationReceivingInput, control?: {signal?: AbortSignal},
): Promise<JobMerchantApplicationReceived>;
