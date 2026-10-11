// MIT. CKAN editions use the existing durable dataset publisher.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { ckanPublisherDriver } from './driver.mjs';

export function openCkanPublisher(options = {}) {
  return openSourceDatasetPublisher(options, ckanPublisherDriver);
}
