// MIT. Merchant-owned idempotency configuration for the existing SF30 launcher.
import { isAbsolute, resolve } from 'node:path';
import { validateHeaderName } from 'node:http';
import { createDurableUpstreamOperations } from './upstream-idempotency.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const keys = new Set(['scope','stateDir','keyEnv','admission','requestHeader','backendHeader',
  'maxEntries','maxStoredBytes','maxTicketSeconds','waitMs']);
const bad = () => { throw new TypeError('Invalid merchant idempotency configuration'); };
function integer(value, fallback, min, max) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) bad();
  return result;
}
function header(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase()) bad();
  try { validateHeaderName(value); } catch { bad(); }
  if (/^(?:host$|connection$|keep-alive$|te$|trailer$|upgrade$|expect$|content-|transfer-|accept-|authorization$|cookie$|set-cookie$|x-api-key$|api-key$|apikey$|proxy-|forwarded$|x-forwarded-|sec-|payment-|x-payment|x402-|extension-responses$|settlement-overrides$)/.test(value)) bad();
  return value;
}

/** No database open or network operation; --check remains a configuration read. */
export function compileUpstreamIdempotency(raw, {env,method,maxResponseBytes,requestHeaders,credentials}) {
  if (raw === undefined) return undefined;
  if (!plain(raw) || Object.keys(raw).some(k => !keys.has(k)) || method !== 'POST' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.scope ?? '') ||
      typeof raw.stateDir !== 'string' || !isAbsolute(raw.stateDir) || resolve(raw.stateDir) !== raw.stateDir ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.keyEnv ?? '') ||
      !/^[A-Za-z_$][\w$]{0,127}$/.test(raw.admission ?? '') || ['__proto__','prototype','constructor'].includes(raw.admission)) bad();
  const secret = Object.hasOwn(env,raw.keyEnv) ? env[raw.keyEnv] : undefined;
  if (typeof secret !== 'string' || !/^[a-fA-F0-9]{64}$/.test(secret)) throw new TypeError('Idempotency keyEnv must contain a 32-byte hexadecimal key');
  const requestHeader = header(raw.requestHeader ?? 'x-merchant-operation');
  const backendHeader = header(raw.backendHeader ?? 'idempotency-key');
  if (requestHeader === backendHeader || [requestHeader,backendHeader].some(k => requestHeaders.includes(k) || Object.hasOwn(credentials,k))) bad();
  return Object.freeze({scope:raw.scope,stateDir:raw.stateDir,key:Buffer.from(secret,'hex'),admission:raw.admission,
    requestHeader,backendHeader,maxResponseBytes,
    maxEntries:integer(raw.maxEntries,10000,1,1000000),
    maxStoredBytes:integer(raw.maxStoredBytes,268435456,maxResponseBytes,17179869184),
    maxTicketSeconds:integer(raw.maxTicketSeconds,86400,1,604800),
    waitMs:integer(raw.waitMs,15000,1,120000)});
}

export function configuredUpstreamIdempotency(compiled) {
  if (!compiled) return undefined;
  const {admission,requestHeader,backendHeader,...options} = compiled;
  return Object.freeze({scope:compiled.scope,requestHeader,backendHeader,
    operations:createDurableUpstreamOperations(options)});
}
