// MIT. Trusted Census adapter for the original source-dataset publisher.
import { openCensusSourceFile, inspectCensusPublicationSource } from '../source.mjs';
import { captureCensusPublicationPlan, checkCensusColumnTypes, encodeCensusRow, validateCensusExtraction } from './plan.mjs';
export const censusPublisherDriver = Object.freeze({
  sourceName: 'Census ACS',
  workspaceSchema: 'stellar-forge.census-acs-publisher-workspace.v1',
  statusSchema: 'stellar-forge.census-acs-publisher-status.v1',
  candidateSchema: 'stellar-forge.census-acs-dataset-candidate.v1',
  capturePlan: captureCensusPublicationPlan,
  inspectSource: inspectCensusPublicationSource,
  openSource: openCensusSourceFile,
  checkColumnTypes: checkCensusColumnTypes,
  encodeRow: encodeCensusRow,
  validateExtraction: validateCensusExtraction,
});
