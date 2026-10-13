import type { GridFabricProcedureCaptureResult } from '../../distribution/discovery/gridfabric-procedure-native.mjs';
export const GRID_PROCEDURE_ARCHIVE_SCHEMA: 'stellar-forge.gridfabric-procedure-archive.v1';
export interface GridProcedureArchive {
  path: string; name: string; content_type: 'application/gzip'; bytes: number;
  sha256: string; capture_sha256: string; members: number;
}
/** Stream every verified native capture member to a new private file. */
export function exportGridProcedureArchive(options: {
  directory: string; outputFile: string;
}): Promise<GridProcedureArchive>;
/** Receive complete original bytes into a new private directory, then run the original offline validator. */
export function receiveGridProcedureArchive(options: {
  file: string; outputDirectory: string; expectedSha256: string; expectedBytes: number;
  maximumExpanded?: number; maximumMembers?: number;
}): Promise<GridFabricProcedureCaptureResult & {
  archive: {schema: typeof GRID_PROCEDURE_ARCHIVE_SCHEMA; bytes: number; sha256: string;
    members: number; expanded_bytes: number};
}>;
