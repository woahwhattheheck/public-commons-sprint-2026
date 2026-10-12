// MIT. Standard SF30 --handlers module; the original launcher owns HTTP and payments.
import {readFile} from 'node:fs/promises';
import {createProduct} from './merchant.mjs';
const config=process.env.FIRECRAWL_PRODUCT_CONFIG;
if(!config)throw new Error('FIRECRAWL_PRODUCT_CONFIG_REQUIRED');
const product=createProduct(JSON.parse(await readFile(config,'utf8')));
export const {firecrawlSearch,admitFirecrawlSearch,firecrawlSearchContent,admitFirecrawlSearchContent,
  firecrawlRead,admitFirecrawlRead}=product.handlers;
export const snapshotFirecrawl=product.snapshot;
export const closeFirecrawl=product.close;
