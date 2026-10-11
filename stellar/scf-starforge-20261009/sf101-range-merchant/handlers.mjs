// MIT. Original SF30 --handlers entrypoint. Merchant secret stays in process env.
import { createRangeStellarHandler, admitRangeStellar } from './range.mjs';

export { admitRangeStellar };
export const rangeStellarTransactions = createRangeStellarHandler();
