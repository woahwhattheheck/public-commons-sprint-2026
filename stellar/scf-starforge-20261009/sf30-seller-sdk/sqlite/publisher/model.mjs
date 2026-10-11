// MIT. Compose the original SQLite source with the maintained publisher engine.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { sqlitePublisherDriver } from './driver.mjs';

export function openSqlitePublisher(options = {}) {
  return openSourceDatasetPublisher(options, sqlitePublisherDriver);
}
