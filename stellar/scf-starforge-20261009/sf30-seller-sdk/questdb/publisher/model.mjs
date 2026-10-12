// MIT. One original durable publisher and schedule implementation.
import { join } from 'node:path';
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { createQuestDbPublisherDriver } from './driver.mjs';
export function openQuestDbPublisher(options={}){
  return openSourceDatasetPublisher(options,createQuestDbPublisherDriver({
    captureDirectory:join(options.directory,'source-captures')}));
}
