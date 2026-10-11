// MIT. MySQL extraction and projection composed into the original publisher.
import { openMysqlSourceFile } from '../config.mjs';
import { captureMysqlPublicationPlan, inspectMysqlPublicationSource,
  checkMysqlDatasetColumnTypes, encodeMysqlDatasetRow, validateMysqlExtraction } from './plan.mjs';

export const mysqlPublisherDriver = Object.freeze({
  sourceName: 'MySQL',
  workspaceSchema: 'stellar-forge.mysql-publisher-workspace.v1',
  statusSchema: 'stellar-forge.mysql-publisher-status.v1',
  candidateSchema: 'stellar-forge.mysql-dataset-candidate.v1',
  capturePlan: captureMysqlPublicationPlan,
  inspectSource: inspectMysqlPublicationSource,
  openSource: (file, { env } = {}) => openMysqlSourceFile(file, { environment: env }),
  checkColumnTypes: checkMysqlDatasetColumnTypes,
  encodeRow: encodeMysqlDatasetRow,
  validateExtraction: validateMysqlExtraction,
});
