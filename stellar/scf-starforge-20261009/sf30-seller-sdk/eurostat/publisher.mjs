// MIT. Original source-dataset publisher with the Eurostat native driver.
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { eurostatPublisherDriver } from './driver.mjs';
export const openEurostatPublisher = options => openSourceDatasetPublisher(options, eurostatPublisherDriver);
