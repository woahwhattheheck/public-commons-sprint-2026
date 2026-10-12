// MIT. Shared record primitives without merchant/server initialization.
import { createHash } from 'node:crypto';

export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fail = (message, status = 400, code = 'ROUTESCAN_INVALID') => {
  throw Object.assign(new Error(message), { status, code });
};
