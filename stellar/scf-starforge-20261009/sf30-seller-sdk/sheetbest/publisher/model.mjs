// MIT. Reuse the original review, version, schedule, recovery and buyer engine.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { sheetBestPublisherDriver } from './driver.mjs';

export function openSheetBestPublisher(options = {}) {
  return openSourceDatasetPublisher(options, sheetBestPublisherDriver);
}
