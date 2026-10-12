// MIT. Shared WFS application values. Source numbers stay in the original OGC parser.
import { fault, object, canonical as normalized, identity, digest as bytesHash, bytes } from '../postgres/publisher/files.mjs';
export const plain = object;
export const clone = value => JSON.parse(JSON.stringify(value));
export const jsonBytes = bytes;
export const hash = bytesHash;
export const digest = identity;
export const canonical = value => JSON.stringify(normalized(value));
export function need(ok,message,code='WFS_INPUT_INVALID',status=400) {if(!ok)throw fault(code,message,status);}
export function operationId(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value),'Use one stable operation ID.','WFS_OPERATION_ID_REQUIRED');return value;
}
export const LIMITS = Object.freeze({pageBytes:8*1024*1024,projectBytes:384*1024*1024,rows:1000000});
