// MIT. Additive production entrypoint; ORIGINAL SF31 payment policy is unchanged.
import { X402BuyerClient } from './buyer.mjs';
import { createPublicHttpsFetch } from './public-transport.mjs';
export function createPublicBuyer({timeoutMs=30_000, ...unsupported}={}) {
  if (Object.keys(unsupported).length) throw new TypeError('Only timeoutMs is configurable');
  return new X402BuyerClient({fetchImpl:createPublicHttpsFetch({timeoutMs}), allowLocal:false});
}
