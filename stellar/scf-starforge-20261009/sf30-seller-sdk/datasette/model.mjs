// MIT. One Datasette driver in the original durable dataset publisher.
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { datasettePublisherDriver } from './driver.mjs';
export function openDatasettePublisher(options={}) { return openSourceDatasetPublisher(options,datasettePublisherDriver); }
