// MIT. Original publisher lifecycle with the Baserow source driver.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { baserowPublisherDriver } from './driver.mjs';
export function openBaserowPublisher(options = {}) {
  return openSourceDatasetPublisher(options, baserowPublisherDriver);
}
