// MIT. Host-declared aliases attach the original authenticated native operator.
import {constants} from 'node:fs';
import {open, realpath} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createNativeOperatorClient} from './client.mjs';
import {plain, requireNative, nativeAlias, nativeOperatorIdentity, nativeCanonicalJSON,
  nativeDigest} from './merchant-export-contract.mjs';

export const NATIVE_OPERATOR_CONNECTION_SCHEMA = 'stellar-forge.native-operator-connection.v1';
export async function readNativePrivateFile(path, maximum = 1024 * 1024) {
  path = resolve(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat({bigint:true});
    requireNative(first.isFile() && first.size <= BigInt(maximum) && !(first.mode & 0o077n) &&
      (process.getuid === undefined || first.uid === BigInt(process.getuid())) && await realpath(path) === path,
    'NATIVE_OPERATOR_PRIVATE_FILE_REQUIRED', 'Use an original private regular host file.');
    const parts = [], buffer = Buffer.alloc(Math.min(maximum + 1, 65536)); let position = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      requireNative(position <= maximum, 'NATIVE_OPERATOR_FILE_TOO_LARGE');
      parts.push(Buffer.from(buffer.subarray(0,bytesRead)));
    }
    const last = await handle.stat({bigint:true});
    requireNative(['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].every(key => first[key] === last[key]) &&
      BigInt(position) === first.size, 'NATIVE_OPERATOR_HOST_FILE_CHANGED');
    return Buffer.concat(parts, position);
  } finally {await handle.close();}
}
function singleLine(value, label) {
  requireNative(typeof value === 'string' && value.trim() && value.length <= 240 && !/[\0-\x1f\x7f]/.test(value),
    'NATIVE_OPERATOR_CONNECTION_INVALID', 'Use a short ' + label + '.');
  return value;
}
export async function readNativeOperatorConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await readNativePrivateFile(path)));
  requireNative(plain(raw) && raw.schema === NATIVE_OPERATOR_CONNECTION_SCHEMA &&
    Object.keys(raw).every(key => ['schema','operators'].includes(key)) && plain(raw.operators) &&
    Object.keys(raw.operators).length >= 1 && Object.keys(raw.operators).length <= 128,
  'NATIVE_OPERATOR_CONNECTION_INVALID', 'Declare the native operator connection and its host aliases.');
  const operators = Object.create(null), base = dirname(path);
  for (const [alias, value] of Object.entries(raw.operators)) {
    nativeAlias(alias);
    requireNative(plain(value) && Object.keys(value).every(key =>
      ['label','operatorUrlFile','operatorUrlEnv','instanceId','timeoutMs','maxResponseBytes'].includes(key)) &&
      Boolean(value.operatorUrlFile) !== Boolean(value.operatorUrlEnv),
    'NATIVE_OPERATOR_CONNECTION_INVALID', 'Each alias selects one original operatorUrlFile or operatorUrlEnv.');
    const entry = {label:singleLine(value.label ?? alias, 'operator label'),
      timeoutMs:value.timeoutMs ?? 120000, maxResponseBytes:value.maxResponseBytes ?? 32 * 1024 * 1024};
    requireNative(Number.isSafeInteger(entry.timeoutMs) && entry.timeoutMs >= 1 && entry.timeoutMs <= 1800000 &&
      Number.isSafeInteger(entry.maxResponseBytes) && entry.maxResponseBytes >= 65536 && entry.maxResponseBytes <= 128 * 1024 * 1024,
    'NATIVE_OPERATOR_CONNECTION_INVALID', 'Choose the original client request deadline and response capacity.');
    if (value.operatorUrlFile !== undefined) {
      requireNative(typeof value.operatorUrlFile === 'string' && value.operatorUrlFile.length > 0 &&
        value.operatorUrlFile.length <= 4096 && !/[\0\r\n]/.test(value.operatorUrlFile),
      'NATIVE_OPERATOR_CONNECTION_INVALID');
      entry.operatorUrlFile = resolve(base, value.operatorUrlFile);
    } else {
      requireNative(typeof value.operatorUrlEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.operatorUrlEnv),
        'NATIVE_OPERATOR_CONNECTION_INVALID');
      entry.operatorUrlEnv = value.operatorUrlEnv;
    }
    if (value.instanceId !== undefined) {
      requireNative(typeof value.instanceId === 'string' &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.instanceId),
      'NATIVE_OPERATOR_CONNECTION_INVALID');
      entry.instanceId = value.instanceId;
    }
    operators[alias] = Object.freeze(entry);
  }
  return Object.freeze({schema:raw.schema, path, operators:Object.freeze(operators)});
}
/** Interpret the original Applications receipt, native stdout JSON, or complete private URL. */
export function nativeOperatorConnectionRecord(text) {
  requireNative(typeof text === 'string' && text.length > 0 && text.length <= 16384,
    'NATIVE_OPERATOR_CONNECTION_INVALID');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return {operatorUrl:trimmed, source:{kind:'ORIGINAL_OPERATOR_URL'}};
  let value; try {value = JSON.parse(trimmed);} catch {requireNative(false, 'NATIVE_OPERATOR_CONNECTION_INVALID');}
  requireNative(plain(value), 'NATIVE_OPERATOR_CONNECTION_INVALID');
  if (value.schema === 'stellar-forge.application-url.v1') {
    requireNative(value.command === 'native-facilitator-operator' &&
      value.source === 'original-command-stdout' && typeof value.url === 'string' &&
      typeof value.applicationId === 'string' && typeof value.operationId === 'string',
    'NATIVE_OPERATOR_CONNECTION_INVALID', 'Choose this native operator’s original Applications URL receipt.');
    return {operatorUrl:value.url, identity:nativeOperatorIdentity(value.original),
      source:{kind:'ORIGINAL_APPLICATION', applicationId:value.applicationId, operationId:value.operationId}};
  }
  requireNative(value.mode === 'NATIVE_FACILITATOR_OPERATOR' &&
    value.schema === 'stellar-forge.native-operator-launch.v1' && typeof value.operatorUrl === 'string',
  'NATIVE_OPERATOR_CONNECTION_INVALID', 'Use the original native operator startup JSON.');
  const {mode, operatorUrl, ...identity} = value;
  return {operatorUrl, identity:nativeOperatorIdentity(identity), source:{kind:'ORIGINAL_NATIVE_STDOUT'}};
}
export async function openNativeOperatorConnection(entry, {environment = process.env, fetchImpl = globalThis.fetch} = {}) {
  let text, sourceSha256;
  if (entry.operatorUrlFile) {
    const bytes = await readNativePrivateFile(entry.operatorUrlFile, 16384);
    text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); sourceSha256 = nativeDigest(bytes);
  } else text = environment[entry.operatorUrlEnv];
  const selected = nativeOperatorConnectionRecord(text);
  const client = createNativeOperatorClient({operatorUrl:selected.operatorUrl, fetch:fetchImpl,
    maxResponseBytes:entry.maxResponseBytes});
  const status = await client.status({signal:AbortSignal.timeout(entry.timeoutMs)});
  const identity = nativeOperatorIdentity(status.workspace);
  requireNative((!entry.instanceId || identity.instanceId === entry.instanceId) &&
    (!selected.identity || nativeCanonicalJSON(selected.identity) === nativeCanonicalJSON(identity)),
  'NATIVE_OPERATOR_INSTANCE_CHANGED', 'The authenticated listener differs from the selected original operator instance.');
  return Object.freeze({client, identity, connection:Object.freeze({...selected.source,
    ...(sourceSha256 ? {sourceSha256} : {})}), origin:client.origin});
}
