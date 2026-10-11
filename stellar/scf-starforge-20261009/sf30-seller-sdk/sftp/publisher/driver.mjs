// MIT. Trusted source composition; the original publisher owns every transition.
import { openSftpSourceFile } from '../config.mjs';
import { captureSftpPublicationPlan, inspectSftpPublicationSource, checkSftpDatasetColumnTypes,
  encodeSftpDatasetRow, validateSftpExtraction } from './plan.mjs';

export const sftpPublisherDriver = Object.freeze({ sourceName: 'SFTP',
  workspaceSchema: 'stellar-forge.sftp-publisher-workspace.v1', statusSchema: 'stellar-forge.sftp-publisher-status.v1',
  candidateSchema: 'stellar-forge.sftp-publisher-candidate.v1',
  capturePlan: captureSftpPublicationPlan, inspectSource: inspectSftpPublicationSource,
  openSource: openSftpSourceFile, checkColumnTypes: checkSftpDatasetColumnTypes,
  encodeRow: encodeSftpDatasetRow, validateExtraction: validateSftpExtraction });
