// MIT. Declared output files belonging to one original immutable paid-job result.
export type JobOutputBytes = string | Uint8Array;
export interface JobOutputFilePolicy {
  filename: string;
  contentType?: string;
  required?: boolean;
  maxBytes?: number;
}
export interface JobPackageOutputDeclaration {
  format: 'package';
  contentType?: 'application/vnd.stellar-forge.job-result+zip';
  filename?: string;
  files: Record<string, JobOutputFilePolicy>;
}
export interface JobPackagePolicy {
  format: 'package';
  contentType: 'application/vnd.stellar-forge.job-result+zip';
  filename: string;
  maxBytes: number;
  files: Record<string, Required<JobOutputFilePolicy>>;
  policySha256: string;
}
export interface JobPackageIdentity {
  bytes: number;
  sha256: string;
  contentType: 'application/vnd.stellar-forge.job-result+zip';
  filename: string;
}
export interface JobPackageJob {
  id: string; functionId: string; inputSha256: string;
  configSha256: string; applicationSha256: string; publicOrigin: string;
  attemptId: string; nativeSettlement: { id: string; at: string };
}
export interface JobPackageFile {
  slot: string; filename: string; contentType: string; bytes: number; sha256: string;
}
export interface JobResultManifest {
  schema: 'stellar-forge.job-result-package.v1';
  job: JobPackageJob; policy: JobPackagePolicy; files: JobPackageFile[];
}
export interface JobPackageDescription {
  package: JobPackageIdentity; manifestSha256: string; manifest: JobResultManifest;
}
export interface JobPackagePacket extends JobPackageDescription {
  body: Buffer; manifestBytes: Buffer;
  file(slot: string): Buffer;
  describe(): JobPackageDescription;
}
export interface JobOutputReceiving {
  schema: 'stellar-forge.job-result-receiving.v1';
  package: JobPackageIdentity; manifestSha256: string; job: JobPackageJob;
  policySha256: string; selectionSha256: string;
  directory: string; archive: 'package.zip'; archivePath: string;
  manifest: 'job-result.json'; manifestPath: string;
  files: Array<JobPackageFile & { path: string }>;
  complete: true; reusedFiles: number;
}
export interface JobPackageReadOptions {
  expected: JobPackageIdentity;
  job?: Partial<JobPackageJob>;
  signal?: AbortSignal;
}
export declare const RESULT_PACKAGE_SCHEMA: 'stellar-forge.job-result-package.v1';
export declare const RESULT_PACKAGE_TYPE: 'application/vnd.stellar-forge.job-result+zip';
export declare const RESULT_PACKAGE_MANIFEST: 'job-result.json';
export declare const RESULT_PACKAGE_MAX_BYTES: 67108864;
export declare const RESULT_PACKAGE_MAX_FILES: 16;
export declare const RESULT_PACKAGE_MANIFEST_BYTES: 65000;
export declare const RESULT_SLOT: RegExp;
export declare const RESULT_RECEIVING_SCHEMA: 'stellar-forge.job-result-receiving.v1';
export declare function normalizePackageOutput(value: JobPackageOutputDeclaration, maxBytes: number): JobPackagePolicy;
export declare function validatePackagePolicy(value: unknown): JobPackagePolicy;
export declare function validatePackageJob(value: unknown, expected?: Partial<JobPackageJob>): JobPackageJob;
export declare function parseResultManifest(bytes: Uint8Array, expected?: Partial<JobPackageJob>): JobResultManifest;
export declare function createResultPackage(result: Record<string, JobOutputBytes>, options: {
  output: JobPackagePolicy; job: JobPackageJob; signal?: AbortSignal;
}): Buffer;
export declare function inspectResultPackage(bytes: Uint8Array, options: JobPackageReadOptions): JobPackagePacket;
export declare function readResultPackage(path: string, options: JobPackageReadOptions): Promise<JobPackagePacket>;
export declare function receiveResultPackage(options: JobPackageReadOptions & {
  source: string; directory: string;
}): Promise<JobOutputReceiving>;
export declare function reopenResultPackage(options: {
  directory: string; expected?: JobPackageIdentity; job?: Partial<JobPackageJob>; signal?: AbortSignal;
}): Promise<JobOutputReceiving>;
