// MIT. Trusted MongoDB source adapter for the original retained publisher.
import { openMongoSourceFile } from '../config.mjs';
import { captureMongoPublicationPlan, inspectMongoPublicationSource, checkMongoDatasetColumnTypes,
  encodeMongoDatasetRow, validateMongoExtraction } from './plan.mjs';

export const mongoPublisherDriver = Object.freeze({
  sourceName: 'MongoDB', workspaceSchema: 'stellar-forge.mongodb-publisher-workspace.v1',
  statusSchema: 'stellar-forge.mongodb-publisher-status.v1', candidateSchema: 'stellar-forge.mongodb-dataset-candidate.v1',
  capturePlan: captureMongoPublicationPlan, inspectSource: inspectMongoPublicationSource,
  openSource: (file, { env } = {}) => openMongoSourceFile(file, { environment: env }),
  checkColumnTypes: checkMongoDatasetColumnTypes, encodeRow: encodeMongoDatasetRow,
  validateExtraction: validateMongoExtraction,
});
