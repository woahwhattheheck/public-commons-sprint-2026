import type { WorkerInputFiles } from '../../jobs/inputs/index.mjs';
import type { NativeProcesses } from '../../jobs/processes.mjs';

export interface DatasetJobInput {
  reportName: string;
  sourceLabel?: string;
  sourceFormat?: 'ndjson' | 'json-array';
  sourceArrayPointer?: string;
  baselineLabel?: string;
  baselineFormat?: 'ndjson' | 'json-array';
  baselineArrayPointer?: string;
  queryJson?: string;
  $files: Record<string, unknown>;
}
export interface DatasetJobContext {
  jobId: string;
  attemptId: string;
  signal: AbortSignal;
  files: WorkerInputFiles;
  processes: NativeProcesses;
}
export function prepareDataset(input: DatasetJobInput, context: DatasetJobContext): Promise<Uint8Array>;
