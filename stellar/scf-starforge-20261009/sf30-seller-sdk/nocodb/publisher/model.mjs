// MIT. Original publisher lifecycle with the NocoDB source driver.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { nocoDBPublisherDriver } from './driver.mjs';
export function openNocoDBPublisher(options = {}) {
  return openSourceDatasetPublisher(options, nocoDBPublisherDriver);
}
