// MIT. One maintained candidate, review, version and buyer workflow.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { mongoPublisherDriver } from './driver.mjs';

export function openMongoPublisher(options = {}) {
  return openSourceDatasetPublisher(options, mongoPublisherDriver);
}
