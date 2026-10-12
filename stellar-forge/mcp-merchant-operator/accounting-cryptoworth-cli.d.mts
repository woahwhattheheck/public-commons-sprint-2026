import type { AccountingCryptoworthClient, OperationKind, Preview, PacketInspection, PacketOptions, RollbackArguments, FileSelection, Sha256 } from './accounting-cryptoworth-client.mjs';
export type PreparedCryptoworthInput = {
  directory: string;
  url: string;
  workspace: string;
  tokenEnv?: string;
} & (
  { kind: OperationKind; preview: Preview } |
  { kind: 'rollback'; arguments: RollbackArguments } |
  { kind: 'packet'; inspection: PacketInspection; packetOptions: PacketOptions }
);
export interface PreparedCryptoworthOperation {
  directory: string;
  request: { schema: 'stellar-forge.accounting-cryptoworth-operation.v1'; createdAt: string; url: string; workspace: string; tokenEnv: string; kind: OperationKind | 'rollback' | 'packet'; sha256: Sha256; [key: string]: unknown };
  submitted: false;
}
export function prepareAccountingCryptoworthOperation(input: PreparedCryptoworthInput): Promise<PreparedCryptoworthOperation>;
export function runAccountingCryptoworthOperation(input: {
  directory: string;
  execute?: boolean;
  client?: AccountingCryptoworthClient;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ directory: string; requestSha256: Sha256; phase: string; executed: boolean; found: boolean; unresolved?: boolean; superseded?: boolean; [key: string]: unknown }>;
export function downloadAccountingCryptoworthFile(input: {
  client: AccountingCryptoworthClient;
  selection: FileSelection;
  expectedSha256: Sha256;
  output: string;
  chunkBytes?: number;
  signal?: AbortSignal;
}): Promise<{ output: string; workspace: string; selection: FileSelection; file: { name: string; bytes: number; sha256: Sha256 }; complete: true }>;
export function main(argv?: string[], options?: { signal?: AbortSignal }): Promise<unknown>;
