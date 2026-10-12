// MIT. All candidates, reviews, releases and recovery belong to the original publisher.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { blsPublisherDriver } from './driver.mjs';
export const openBlsPublisher = options => openSourceDatasetPublisher(options, blsPublisherDriver);
