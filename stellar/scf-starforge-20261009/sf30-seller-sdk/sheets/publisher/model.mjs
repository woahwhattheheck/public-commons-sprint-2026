// MIT. No Sheets-specific publisher database, review or version implementation.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { sheetsPublisherDriver } from './driver.mjs';

export function openSheetsPublisher(options = {}) {
  return openSourceDatasetPublisher(options, sheetsPublisherDriver);
}
