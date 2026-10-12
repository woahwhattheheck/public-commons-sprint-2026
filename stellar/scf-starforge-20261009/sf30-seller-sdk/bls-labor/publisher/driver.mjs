// MIT. Trusted Bls adapter for the original source-dataset publisher.
import { openBlsSourceFile, inspectBlsPublicationSource } from '../source.mjs';
import { captureBlsPublicationPlan, checkBlsColumnTypes, encodeBlsRow, validateBlsExtraction } from './plan.mjs';
export const blsPublisherDriver = Object.freeze({
  sourceName: 'BLS labor',
  workspaceSchema: 'stellar-forge.bls-labor-publisher-workspace.v1',
  statusSchema: 'stellar-forge.bls-labor-publisher-status.v1',
  candidateSchema: 'stellar-forge.bls-labor-dataset-candidate.v1',
  capturePlan: captureBlsPublicationPlan,
  inspectSource: inspectBlsPublicationSource,
  openSource: openBlsSourceFile,
  checkColumnTypes: checkBlsColumnTypes,
  encodeRow: encodeBlsRow,
  validateExtraction: validateBlsExtraction,
});
