// MIT. Opendatasoft editions use the existing durable dataset publisher.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { opendatasoftPublisherDriver } from './driver.mjs';

export function openOpendatasoftPublisher(options = {}) {
  return openSourceDatasetPublisher(options, opendatasoftPublisherDriver);
}

