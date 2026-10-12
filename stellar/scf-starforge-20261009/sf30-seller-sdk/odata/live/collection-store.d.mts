// MIT. Collections in the original OData live service and workspace.
import type { ODataCollection,ODataCollectionLimits,ODataCollectionNamedFile } from './collection.mjs';
export interface ODataServiceCollectionProfile {
  schema: 'stellar-forge.odata-live-profile.v1'; id: string; name: string;
  planId: string; operation: string; sourceBinding: string; createdAt: string;
  settings: {port: number; operationsPort: number; facilitator: string | null; allowLoopback: boolean};
  files: string[];
}
export type ODataCollectionSequence = <T>(operation: () => Promise<T>) => Promise<T>;
export type ODataServiceCollectionSummary = Pick<ODataCollection,
  'title'|'sourceBinding'|'operation'|'entitySet'|'query'|'queryFingerprint'|'rows'|'pageCount'|'keyFields'|
  'completion'|'reportedCounts'|'countConsistent'|'acquisition'|'manifestSha256'|'analysis'> & {id: string; status: 'READY'};
export interface ODataServiceCollectionPending {
  id: string; status: 'INCOMPLETE'; sourceBinding: string; operation: string;
}
export interface ODataServiceCollectionInput {
  id: string; title?: string; fields?: string[]; limits?: Partial<ODataCollectionLimits>;
  /** Original response order. Omitted buyerId uses the saved initial/previous next request. */
  pages: Array<{receivedId: string; buyerId?: string}>;
}
export interface ODataServiceCollectionTransferFile extends ODataCollectionNamedFile {bodyBase64: string}
export interface ODataServiceCollectionController {
  list(): Promise<Array<ODataServiceCollectionSummary | ODataServiceCollectionPending>>;
  collect(input: ODataServiceCollectionInput): Promise<ODataCollection & {id: string}>;
  restore(input: {id: string; sourceManifest: string; expectedSha256: string}): Promise<ODataCollection & {
    id: string; restoredFrom: {bytes: number; sha256: string}}>;
  inspect(id: string): Promise<ODataCollection & {id: string; retainedFiles: ODataCollectionNamedFile[]}>;
  rows(id: string, options?: {offset?: number; limit?: number}): Promise<{
    collectionSha256: string; sourceBinding: string; operation: string; metadataSha256: string; serviceRoot: string; merchantOrigin: string;
    offset: number; total: number; rows: Record<string, unknown>[]; nextOffset: number | null}>;
  file(id: string,name: string): Promise<{name: string; relative: string; bytes: Uint8Array; sha256: string}>;
}
export declare function openServiceCollections(input: {
  directory: string; profile: ODataServiceCollectionProfile; sequence: ODataCollectionSequence;
}): Promise<ODataServiceCollectionController>;
/** Call within Workspace.backup's original live state lease. */
export declare function serviceCollectionFiles(input: {
  directory: string; profile: ODataServiceCollectionProfile;
}): Promise<{collections: ODataServiceCollectionSummary[]; files: ODataServiceCollectionTransferFile[]}>;
export declare function parseCollectionTransferPath(path: string): {
  serviceId: string; collectionId: string; file: string;
} | null;
/** Before writing any transfer files; the existing native restore owns publication. */
export declare function validateServiceCollectionTransfer(input: {
  profile: ODataServiceCollectionProfile; files: Array<{path: string; sha256: string; bodyBase64: string; bytes?: number}>;
}): Array<{id: string; sourceBinding: string; operation: string; manifestSha256: string; files: string[]}>;
/** After writing original files, before publishing the receiving workspace state. */
export declare function verifyServiceCollections(input: {
  directory: string; profile: ODataServiceCollectionProfile;
}): Promise<ODataServiceCollectionSummary[]>;
