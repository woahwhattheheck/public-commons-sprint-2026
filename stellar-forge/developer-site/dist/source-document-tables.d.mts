export const DOCUMENT_TABLE_SOURCE_SCHEMA: 'stellar-forge.document-table-source.v1';
export const DOCUMENT_TABLE_PROJECTION_SCHEMA: 'stellar-forge.document-table-projection.v1';
export const DOCUMENT_TABLE_LIMITS: Readonly<{bytes:number;tables:number;rows:number;columns:number;cells:number}>;

export interface DocumentMetadata {
  filename?: string; url?: string; title?: string; sha256?: string; bytes?: number; pageCount?: number;
  [key:string]: unknown;
}
export interface DocumentExtractionMetadata {
  provider?: string; extractedAt?: string; method?: string; [key:string]: unknown;
}
export interface DocumentTableLocation {
  /** One-based original table number. */ tableIndex: number;
  /** One-based original document page, when supplied. */ page?: number;
  label?: string; [key:string]: unknown;
}
export interface DocumentTableSourceInput {
  filename: string; sourceText: string; sourceUrl?: string;
  document?: DocumentMetadata; extraction?: DocumentExtractionMetadata;
  tableLocations?: DocumentTableLocation[];
}
export interface DocumentTableSource {
  schema: typeof DOCUMENT_TABLE_SOURCE_SCHEMA;
  /** Identity of complete text plus source/document/extraction metadata. */ id: string;
  filename: string; sourceText: string; sourceUrl: string;
  /** Exact UTF-8 extraction-text length and digest. */ bytes: number; sha256: string;
  document: DocumentMetadata; extraction: DocumentExtractionMetadata;
  tableLocations: DocumentTableLocation[];
}
export interface DocumentCellOrigin {
  /** All table, row and column coordinates are one-based. */ tableIndex:number; row:number; column:number;
  rowspan:number; colspan:number;
  /** JavaScript UTF-16 character offsets into the original complete source text. */ htmlStart:number; htmlEnd:number;
}
export interface DocumentTableCell extends DocumentCellOrigin {
  kind:'td'|'th'; html:string; innerHTML:string; text:string;
}
export interface DocumentTableRow {
  row:number; htmlStart:number; htmlEnd:number;
  /** Zero-based indices into this table's cells array. */ cells:number[];
}
export interface ParsedDocumentTable {
  tableIndex:number; htmlStart:number; htmlEnd:number; html:string;
  rows:DocumentTableRow[]; cells:DocumentTableCell[];
  /** Zero-based row/column arrays; entries are cell-array indices or absent-cell null. */ grid:(number|null)[][];
  rowCount:number; columnCount:number; unresolvedEntities:string[];
}
export interface DocumentTableInspection {
  sourceId:string; filename:string; sha256:string; bytes:number;
  tables:(ParsedDocumentTable & {location:DocumentTableLocation|null})[];
}
export type DocumentMergedCells = 'anchor'|'repeat'|'reject';
export type DocumentWhitespace = 'preserve'|'trim'|'collapse';
export interface DocumentTableExclusion {row:number;reason?:string;}
export interface DocumentTableSelection {
  tableIndex:number;headerRows:number[];dataRows:number[];columns:number[];
  excludedRows?:DocumentTableExclusion[];mergedCells:DocumentMergedCells;whitespace:DocumentWhitespace;
}
export interface RetainedDocumentTableSelection extends DocumentTableSelection {
  excludedRows:{row:number;reason:string}[];
}
export interface ProjectedDocumentCell {
  column:number;value:string;originalText:string|null;origin:DocumentCellOrigin|null;
  covered:boolean;missing:boolean;
}
export interface ProjectedDocumentRow {
  /** Output CSV record: first data row is record 2 after the projected header. */ record:number;
  /** One-based original source row. */ row:number;cells:ProjectedDocumentCell[];
}
export interface DocumentTableProjection {
  schema:typeof DOCUMENT_TABLE_PROJECTION_SCHEMA;id:string;sourceId:string;
  selection:RetainedDocumentTableSelection;headings:string[];
  headerCells:{row:number;cells:ProjectedDocumentCell[]}[];
  csv:string;bytes:number;sha256:string;rows:ProjectedDocumentRow[];
  omittedRows:{row:number;kind:'excluded'|'outside-selection';reason:string}[];
  table:{tableIndex:number;rows:number;columns:number;htmlStart:number;htmlEnd:number;location:DocumentTableLocation|null};
  summary:{
    sourceRows:number;dataRows:number;headerRows:number;omittedRows:number;columns:number;
    coveredValues:number;missingCells:number;unresolvedEntities:string[];
  };
}
export function parseDocumentTables(input:string):ParsedDocumentTable[];
export function createDocumentTableSource(input:DocumentTableSourceInput):Promise<DocumentTableSource>;
export function validateDocumentTableSource(source:DocumentTableSource):Promise<DocumentTableSource>;
export function inspectDocumentTables(source:DocumentTableSource):Promise<DocumentTableInspection>;
export function projectDocumentTable(source:DocumentTableSource,selection:DocumentTableSelection):Promise<DocumentTableProjection>;
export function validateDocumentTableProjection(input:{source:DocumentTableSource;projection:DocumentTableProjection}):Promise<{source:DocumentTableSource;projection:DocumentTableProjection}>;
