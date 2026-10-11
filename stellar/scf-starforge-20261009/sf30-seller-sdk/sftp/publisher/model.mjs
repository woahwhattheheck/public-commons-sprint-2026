// MIT. Native SFTP files use the original retained publisher state machine.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { sftpPublisherDriver } from './driver.mjs';

export function openSftpPublisher(options) { return openSourceDatasetPublisher(options, sftpPublisherDriver); }
