// MIT. CSDL source meaning through the original dataset physical declaration.
import type { ODataEdition, ODataSourceSemantics, ODataSemanticDocument,
  ODataCaptureManifest, ODataDatasetField, ODataSemanticColumn } from './types.mjs';
export declare const ODATA_SEMANTICS_SCHEMA: 'stellar-forge.odata-semantics.v1';
export declare function describeODataSemantics(input: {
  edition: ODataEdition; metadataBytes: Uint8Array;
}): ODataSourceSemantics;
export declare function odataCaptureManifest(edition: ODataEdition): ODataCaptureManifest;
export declare function projectODataSemantics(input: {
  edition: ODataEdition; metadataBytes: Uint8Array; mapping: ODataDatasetField[];
  columns: Array<Pick<ODataSemanticColumn, 'name' | 'type' | 'nullable'>> |
    Record<string, ODataSemanticColumn['type'] | { type: ODataSemanticColumn['type']; nullable?: boolean }>;
}): ODataSemanticDocument;
export declare function compareODataSemantics(before: ODataSemanticDocument, after: ODataSemanticDocument): {
  changed: boolean; beforeDefinitionSha256: string; afterDefinitionSha256: string;
  fields: Array<{ name: string; before: ODataSemanticColumn | null; after: ODataSemanticColumn | null }>;
  primaryKey: { before: ODataSemanticDocument['primaryKey']; after: ODataSemanticDocument['primaryKey'] };
  sourceDocumentChanged: boolean;
};
