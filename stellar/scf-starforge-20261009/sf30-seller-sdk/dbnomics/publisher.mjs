// MIT. DBnomics adapter for the maintained durable dataset publisher.
import {openSourceDatasetPublisher} from '../postgres/publisher/model.mjs';
import {dbnomicsPublisherDriver} from './driver.mjs';
export const openDbnomicsPublisher=options=>openSourceDatasetPublisher(options,dbnomicsPublisherDriver);
