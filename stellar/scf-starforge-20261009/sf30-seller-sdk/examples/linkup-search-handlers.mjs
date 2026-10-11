// MIT. Original seller --handlers module for Linkup's synchronous search API.
import { readUpstreamBindings } from '../upstream.mjs';
import { createLinkupSearchHandlers } from '../linkup-search.mjs';

const bindings = await readUpstreamBindings(process.env.LINKUP_SEARCH_UPSTREAMS ??
  new URL('./linkup-search-upstreams.json', import.meta.url));
const application = createLinkupSearchHandlers(bindings);
export const { linkupSearch, admitLinkupSearch, linkupAnswer, admitLinkupAnswer } = application.handlers;
export const snapshotLinkupSearch = application.snapshot;
export const closeLinkupSearch = application.close;
