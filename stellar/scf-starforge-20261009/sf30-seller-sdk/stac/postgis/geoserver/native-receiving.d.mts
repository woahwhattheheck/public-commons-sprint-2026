/// <reference types="node" />
import type { PreparePublication, NativeReaderBinding, SourceFile, GeoServerArchive, OperationId, Sha256 } from './index.mjs';
export interface GeoServerNativeHandoff {
  schema: 'starforge.geoserver-native-handoff.v1';
  /** Stable identifier for this original GeoServer receiving child. */
  operationId: OperationId;
  /** Original parent database/customer operation; may include the parent's colon separators. */
  parentOperationId: string;
  /** Complete source commit selected by the original native job. */
  sourceHead: string;
  /** Private, create-only receiving output, separate from all source/operator directories. */
  directory: string;
  workspaceDirectory: string;
  profileFile: string; readerFile: string;
  expectedProfileSha256: Sha256; expectedReaderSha256: Sha256;
  request: PreparePublication & Required<Pick<PreparePublication, 'kind' | 'expectedPublication'>>;
  /** Explicitly selects the same-receipt native service rollback followed by refresh. */
  cycle?: { rollbackOperationId: OperationId; refreshOperationId: OperationId };
  browser?: { playwrightModule: string; chromiumExecutable: string };
}
export interface GeoServerNativeExport {
  name: string; operationId: OperationId; requestSha256: Sha256; reviewSha256: Sha256;
  state: 'EXPORTED' | 'ROLLED_BACK'; directory: string; manifestSha256: Sha256; archive: GeoServerArchive;
  ownedSteps: string[]; operationFile: SourceFile; projectId: string;
  postgis: { editionId: string; revision: number }; native: Array<Record<string, unknown>>;
}
export interface GeoServerNativeReopen {
  originalInstance: string; reopenedInstance: string; workspace: string; operationId: OperationId;
  state: string; requestSha256: Sha256; reviewSha256: Sha256;
}
export interface GeoServerNativeBrowser {
  browser: string; operationId: OperationId; reviewSha256: Sha256; maps: number;
  screenshot: SourceFile; download: SourceFile;
}
export interface GeoServerNativeAdoption {
  directory: string; operationId: OperationId; requestSha256: Sha256;
  reviewSha256: Sha256; manifestSha256: Sha256;
}
export interface GeoServerNativeResult {
  schema: 'starforge.geoserver-native-result.v1'; state: 'complete';
  operationId: OperationId; parentOperationId: string; requestSha256: Sha256; sourceHead: string;
  nativeBinding: NativeReaderBinding; projectId: string;
  postgis: { editionId: string; revision: number }; finalPublication: OperationId;
  exports: GeoServerNativeExport[]; reopen: GeoServerNativeReopen;
  browser: GeoServerNativeBrowser | null;
  cycle: GeoServerNativeExport | { state: 'NO_OWNED_CHANGES'; operationId: OperationId; ownedSteps: [] } | null;
  adoptions: GeoServerNativeAdoption[]; files: SourceFile[];
}
export interface GeoServerNativeOptions {
  environment?: NodeJS.ProcessEnv; signal?: AbortSignal;
  progress?: (event: { operationId: OperationId; phase: string; state: 'running' | 'retained' | 'complete' }) => void | Promise<void>;
  /** Defaults false for composed callers; the direct command retains both OS signal handlers. */
  processSignals?: boolean;
  stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream;
}
export function runGeoServerNativeReceiving(input: GeoServerNativeHandoff, options?: GeoServerNativeOptions): Promise<GeoServerNativeResult>;
export function main(argv?: string[]): Promise<GeoServerNativeResult | { error: Error; exitCode: number }>;
