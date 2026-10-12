// MIT. Bounds for the retained RIS intake and its complete review.
export const RIS_SOURCE_SCHEMA='sf88-research-ris-source-v1';
export const RIS_EDITION_SCHEMA='sf88-research-ris-edition-v1';
export const RIS_PREVIEW_SCHEMA='sf88-research-ris-preview-v1';
export const RIS_LIMITS=Object.freeze({documentBytes:8*1024*1024,totalDocumentBytes:8*1024*1024,
  sourceBytes:16*1024*1024,editionBytes:64*1024*1024,documents:32,records:5000,
  fieldsPerRecord:4096,recordBytes:2*1024*1024,lineBytes:2*1024*1024,provenanceBytes:65536,
  linesPerDocument:200000,totalLines:200000,diagnostics:10000});
export const RIS_PARSER_VERSION='lossless-ris-v1';
