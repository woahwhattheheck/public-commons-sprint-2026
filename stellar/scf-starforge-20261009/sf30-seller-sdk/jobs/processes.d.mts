export interface NativeProcessRequest {
  command: string[];
  cwd?: string;
  input?: Uint8Array;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}
export interface NativeProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}
export interface NativeProcesses {
  directory(): Promise<string>;
  run(request: NativeProcessRequest): Promise<NativeProcessResult>;
  close(): void;
}
export function createNativeProcessesClient(
  port: import('node:worker_threads').MessagePort, signal?: AbortSignal
): NativeProcesses;
