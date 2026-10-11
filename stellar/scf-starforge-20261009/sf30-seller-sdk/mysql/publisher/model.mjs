// MIT. Keep the original durable candidate, review, version and buyer engine.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { mysqlPublisherDriver } from './driver.mjs';

export function openMysqlPublisher(options) {
  return openSourceDatasetPublisher(options, mysqlPublisherDriver);
}
