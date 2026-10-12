// MIT. Reuse the original retained publisher and recurring policy implementation.
import { join } from 'node:path';
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { createRisingWavePublisherDriver } from './driver.mjs';
export function openRisingWavePublisher(options={}){
  return openSourceDatasetPublisher(options,createRisingWavePublisherDriver({captureDirectory:join(options.directory,'source-captures')}));
}
