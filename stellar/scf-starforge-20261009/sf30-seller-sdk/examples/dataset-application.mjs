// MIT. The same handler map works in the original serve.mjs --handlers interface.
import { loadDatasetConfig } from '../dataset-handler.mjs';
const dataset = await loadDatasetConfig(process.env.SF30_DATASET_CONFIG ??
  new URL('./inventory-dataset.json', import.meta.url));
export const queryDataset = dataset.handle;
export const admitDataset = dataset.admit;
