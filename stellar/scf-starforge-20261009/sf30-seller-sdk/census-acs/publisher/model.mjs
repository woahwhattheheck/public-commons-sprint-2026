// MIT. All candidates, reviews, releases and recovery belong to the original publisher.
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { censusPublisherDriver } from './driver.mjs';
export const openCensusPublisher = options => openSourceDatasetPublisher(options, censusPublisherDriver);
