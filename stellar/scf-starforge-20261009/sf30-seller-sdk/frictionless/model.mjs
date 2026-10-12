// MIT. Same workspace, browser, review, schedule, version and buyer operations.
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { frictionlessPublisherDriver } from './driver.mjs';
export function openFrictionlessPublisher(options = {}) {
  return openSourceDatasetPublisher(options, frictionlessPublisherDriver);
}
