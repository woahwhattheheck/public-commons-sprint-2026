// MIT. Preserve the original Palmera/Safe SDK transaction and Tenderly public body.
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, need, object, digest, jsonBytes, parseJson, privateDirectory,
  readBytes, readJson, writeBytes, syncDirectory, matchingWriteTemporaries } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { expectedFromRequest, equalExpected } from '../tenderly-stellar-pilot/customer/contract.mjs';

export const SELECTION_SCHEMA = 'stellar-forge.safe-simulation-selection.v1';
export const TRANSACTION_SCHEMA = 'stellar-forge.original-safe-transaction.v1';
export const MAX_SELECTION_BYTES = 4 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const FIELDS = ['to','value','data','operation','safeTxGas','baseGas','gasPrice','gasToken','refundReceiver','nonce'];
const INPUTS = ['safe-transaction.json','simulation.json'];
export const SDK_SOURCE = Object.freeze({
  palmera: 'https://github.com/keyper-labs/palmera-module-sdk/blob/main/src/Palmera.ts',
  palmeraSourceBlob: '9347187b5f1c86afd7e08fa2a78c0c885733cbf3',
  safe: 'https://github.com/safe-global/safe-core-sdk/blob/r45/packages/protocol-kit/src/Safe.ts',
  reviewedProtocolKitVersion: '4.1.0',
  palmeraPackageVersion: '1.0.0-beta.1'
});
function uint(value, field) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) &&
    BigInt(value) < (1n << 256n), 'SAFE_' + field + '_EXACT_UINT256_REQUIRED');
}
function nativeData(value) {
  need(object(value) && Object.keys(value).length === FIELDS.length &&
    FIELDS.every(key => Object.hasOwn(value,key)), 'ORIGINAL_SAFE_TRANSACTION_DATA_REQUIRED');
  need(ADDRESS.test(value.to) && ADDRESS.test(value.gasToken) && ADDRESS.test(value.refundReceiver),
    'SAFE_TRANSACTION_ADDRESS_INVALID');
  need(typeof value.data === 'string' && HEX.test(value.data), 'SAFE_TRANSACTION_CALLDATA_INVALID');
  need(value.operation === 0 || value.operation === 1, 'SAFE_OPERATION_INVALID');
  for (const field of ['value','safeTxGas','baseGas','gasPrice']) uint(value[field], field.toUpperCase());
  need(Number.isSafeInteger(value.nonce) && value.nonce >= 0, 'SAFE_EXACT_NONCE_REQUIRED');
  return value;
}
function originalTransaction(transaction) {
  need(object(transaction) && typeof transaction.encodedSignatures === 'function',
    'ORIGINAL_SAFE_TRANSACTION_REQUIRED');
  const data = parseJson(jsonBytes(nativeData(transaction.data)));
  const signatures = transaction.encodedSignatures();
  need(typeof signatures === 'string' && HEX.test(signatures), 'ORIGINAL_SAFE_SIGNATURE_BYTES_REQUIRED');
  return {data, encodedSignatures: signatures};
}
function originRecord(value = {}) {
  need(object(value) && Object.keys(value).every(key => ['application','operation','reference'].includes(key)),
    'SAFE_ORIGIN_FIELDS_INVALID');
  const result = {};
  for (const field of ['application','operation','reference']) {
    if (value[field] === undefined) continue;
    need(typeof value[field] === 'string' && value[field].length <= 2000, 'SAFE_ORIGIN_TEXT_INVALID');
    result[field] = value[field];
  }
  return result;
}
function contextRecord(context, identity, input) {
  need(object(context) && Object.keys(context).length === 6 &&
    ['networkId','blockNumber','transactionIndex','from','gas','value'].every(key => Object.hasOwn(context,key)),
    'SAFE_EXPLICIT_SIMULATION_CONTEXT_REQUIRED');
  need(context.networkId === identity.networkId, 'SAFE_SDK_NETWORK_SELECTION_MISMATCH');
  const body = {block_number:context.blockNumber,transaction_index:context.transactionIndex,
    from:context.from,to:identity.address,input,gas:context.gas,value:context.value};
  const expected = expectedFromRequest(body, context.networkId);
  need(jsonBytes(body).length <= 1048576, 'TENDERLY_PUBLIC_BODY_SIZE_LIMIT');
  return {body, expected};
}
async function identityOf(safe) {
  const [address, chainId, contractVersion] = await Promise.all([
    safe.getAddress(), safe.getChainId(), safe.getContractVersion()
  ]);
  const networkId = typeof chainId === 'bigint' ? chainId.toString() : chainId;
  need(typeof networkId === 'string' && /^[1-9][0-9]{0,19}$/.test(networkId), 'ORIGINAL_SAFE_CHAIN_ID_INVALID');
  need(typeof address === 'string' && ADDRESS.test(address), 'ORIGINAL_SAFE_ADDRESS_INVALID');
  need(typeof contractVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(contractVersion),
    'ORIGINAL_SAFE_CONTRACT_VERSION_INVALID');
  return {address,networkId,contractVersion};
}
/**
 * Use the caller's initialized original Safe instance and original SafeTransaction.
 * SDK reads and encoding only; the caller chooses the executor and pinned EVM context.
 */
export async function captureSafeTransaction({safe, transaction, context, label = '', origin = {}}) {
  need(object(safe) && ['getAddress','getChainId','getContractVersion','getEncodedTransaction',
    'getTransactionHash','isSafeDeployed'].every(name => typeof safe[name] === 'function'),
    'ORIGINAL_PROTOCOL_KIT_INSTANCE_REQUIRED');
  need(typeof label === 'string' && label.length <= 160, 'SAFE_REVIEW_LABEL_INVALID');
  const selectedContext=parseJson(jsonBytes(context)),selectedOrigin=originRecord(origin);
  need(object(selectedContext)&&Object.keys(selectedContext).length===6&&
    ['networkId','blockNumber','transactionIndex','from','gas','value'].every(key=>Object.hasOwn(selectedContext,key)),
    'SAFE_EXPLICIT_SIMULATION_CONTEXT_REQUIRED');
  const before = originalTransaction(transaction), identity = await identityOf(safe);
  need(await safe.isSafeDeployed(), 'DEPLOYED_SAFE_REQUIRED');
  // The reviewed original SDK encoders read only data and encodedSignatures().
  // Hold those exact selected values stable while its ordinary RPC reads finish.
  const selectedTransaction = Object.freeze({data:Object.freeze(before.data),
    encodedSignatures:() => before.encodedSignatures});
  const [encodedTransaction, transactionHash] = await Promise.all([
    safe.getEncodedTransaction(selectedTransaction), safe.getTransactionHash(selectedTransaction)
  ]);
  need(typeof encodedTransaction === 'string' && HEX.test(encodedTransaction) && encodedTransaction.length >= 10,
    'ORIGINAL_SAFE_EXEC_TRANSACTION_ENCODING_REQUIRED');
  need(typeof transactionHash === 'string' && WORD.test(transactionHash), 'ORIGINAL_SAFE_TRANSACTION_HASH_REQUIRED');
  const after = originalTransaction(transaction), finalIdentity = await identityOf(safe);
  need(jsonBytes(before).equals(jsonBytes(after)) && jsonBytes(identity).equals(jsonBytes(finalIdentity)),
    'SAFE_TRANSACTION_CHANGED_DURING_CAPTURE');
  const {body,expected} = contextRecord(selectedContext,identity,encodedTransaction);
  const record = {schema:TRANSACTION_SCHEMA,label,origin:selectedOrigin,identity,
    transactionHash,data:before.data,encodedSignatures:before.encodedSignatures,encodedTransaction,
    simulationContext:selectedContext,expected,sdkSource:SDK_SOURCE};
  need(jsonBytes(record).length <= MAX_SELECTION_BYTES, 'SAFE_SELECTION_SIZE_LIMIT');
  return {record,body};
}
/** Palmera exposes its original Safe SDK; the transaction is the caller's existing result. */
export async function capturePalmeraTransaction({palmera, ...options}) {
  need(object(palmera) && typeof palmera.getSafeSDK === 'function', 'ORIGINAL_PALMERA_INSTANCE_REQUIRED');
  return captureSafeTransaction({...options,safe:palmera.getSafeSDK(),
    origin:{application:'Palmera',...options.origin}});
}
export async function exactWrite(path, data) {
  path = absolute(path);
  try {
    const old = await readBytes(path, data.length);
    need(old.equals(data), 'SAFE_REVIEW_RETAINED_FILE_CHANGED');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await writeBytes(path,data,{exclusive:true}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readBytes(path,data.length)).equals(data), 'SAFE_REVIEW_RETAINED_FILE_CHANGED');
  }
}
function validateCaptured(record, body) {
  need(object(record) && record.schema === TRANSACTION_SCHEMA && object(record.identity), 'SAFE_SELECTION_RECORD_INVALID');
  need(typeof record.label === 'string' && record.label.length <= 160 &&
    typeof record.identity.address === 'string' && ADDRESS.test(record.identity.address) &&
    typeof record.identity.networkId === 'string' && /^[1-9][0-9]{0,19}$/.test(record.identity.networkId) &&
    typeof record.identity.contractVersion === 'string' && record.identity.contractVersion.length <= 80,
    'SAFE_SELECTION_IDENTITY_INVALID');
  nativeData(record.data);
  need(typeof record.encodedSignatures === 'string' && HEX.test(record.encodedSignatures) &&
    typeof record.encodedTransaction === 'string' && HEX.test(record.encodedTransaction) &&
    WORD.test(record.transactionHash), 'SAFE_SELECTION_TRANSACTION_INVALID');
  const expected = contextRecord(record.simulationContext,record.identity,record.encodedTransaction);
  need(jsonBytes(expected.body).equals(jsonBytes(body)) && equalExpected(record.expected,expected.expected),
    'SAFE_SELECTION_PUBLIC_REQUEST_MISMATCH');
  originRecord(record.origin);
}
export async function saveSelection(directory, captured) {
  directory = await privateDirectory(absolute(directory));
  need(await realpath(directory) === directory, 'SAFE_SELECTION_DIRECTORY_SYMLINK');
  validateCaptured(captured.record,captured.body);
  const inputs = {'safe-transaction.json':jsonBytes(captured.record),'simulation.json':jsonBytes(captured.body)};
  const files = Object.fromEntries(Object.entries(inputs).map(([name,b]) => [name,{bytes:b.length,sha256:digest(b)}]));
  const identity = {schema:SELECTION_SCHEMA,files};
  const manifest = {...identity,id:digest(jsonBytes(identity))};
  const allowed = [...INPUTS,'selection.json'];
  const temporary=await matchingWriteTemporaries(directory,[...Object.values(inputs),jsonBytes(manifest)]);
  need((await readdir(directory)).every(name=>allowed.includes(name)||temporary.has(name)), 'SAFE_SELECTION_DESTINATION_CONFLICT');
  for (const [name,bytes] of Object.entries(inputs)) await exactWrite(join(directory,name),bytes);
  await exactWrite(join(directory,'selection.json'),jsonBytes(manifest));
  await syncDirectory(directory);
  return openSelection(directory);
}
export async function prepareSafeSelection({directory,...options}) {
  return saveSelection(directory,await captureSafeTransaction(options));
}
export async function preparePalmeraSelection({directory,...options}) {
  return saveSelection(directory,await capturePalmeraTransaction(options));
}
export async function openSelection(directory) {
  directory = await privateDirectory(absolute(directory),{create:false});
  need(await realpath(directory) === directory, 'SAFE_SELECTION_DIRECTORY_SYMLINK');
  const manifest = await readJson(join(directory,'selection.json'),16384);
  need(manifest.schema === SELECTION_SCHEMA && HASH.test(manifest.id) && object(manifest.files) &&
    Object.keys(manifest.files).length === INPUTS.length && INPUTS.every(name=>Object.hasOwn(manifest.files,name)),
    'SAFE_SELECTION_MANIFEST_INVALID');
  const bytes = {};
  for (const name of INPUTS) {
    const f=manifest.files[name];
    need(object(f) && Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= MAX_SELECTION_BYTES && HASH.test(f.sha256),
      'SAFE_SELECTION_FILE_DESCRIPTOR_INVALID');
    bytes[name] = await readBytes(join(directory,name),f.bytes);
    need(bytes[name].length === f.bytes && digest(bytes[name]) === f.sha256, 'SAFE_SELECTION_FILE_CHANGED');
  }
  need(manifest.id === digest(jsonBytes({schema:manifest.schema,files:manifest.files})), 'SAFE_SELECTION_ID_CHANGED');
  const record=parseJson(bytes['safe-transaction.json']),body=parseJson(bytes['simulation.json']);
  validateCaptured(record,body);
  return {id:manifest.id,directory,manifest,record,body,expected:record.expected,
    transactionFile:join(directory,'safe-transaction.json'),bodyFile:join(directory,'simulation.json'),
    selectionFile:join(directory,'selection.json'),bytes};
}
export async function receiveSelection(sourceDirectory, destinationDirectory) {
  const source=await openSelection(sourceDirectory);
  destinationDirectory=await privateDirectory(absolute(destinationDirectory));
  need(await realpath(destinationDirectory)===destinationDirectory,'SAFE_SELECTION_DIRECTORY_SYMLINK');
  const manifestBytes=await readBytes(source.selectionFile,16384);
  const temporary=await matchingWriteTemporaries(destinationDirectory,[...Object.values(source.bytes),manifestBytes]);
  need((await readdir(destinationDirectory)).every(name=>[...INPUTS,'selection.json'].includes(name)||temporary.has(name)),
    'SAFE_SELECTION_DESTINATION_CONFLICT');
  for(const name of INPUTS)await exactWrite(join(destinationDirectory,name),source.bytes[name]);
  await exactWrite(join(destinationDirectory,'selection.json'),manifestBytes);
  const received=await openSelection(destinationDirectory);
  need(received.id===source.id,'SAFE_SELECTION_RECEIVING_ID_MISMATCH');
  return received;
}
export function describeSelection(selection) {
  const r=selection.record;
  return {id:selection.id,label:r.label,origin:r.origin,safe:r.identity,transactionHash:r.transactionHash,
    nonce:r.data.nonce,innerTransaction:{to:r.data.to,value:r.data.value,operation:r.data.operation,data:r.data.data},
    encodedSignaturesBytes:(r.encodedSignatures.length-2)/2,
    encodedExecutionBytes:(r.encodedTransaction.length-2)/2,
    simulation:r.expected,bodySha256:selection.manifest.files['simulation.json'].sha256,
    bodyFile:selection.bodyFile,directory:selection.directory};
}
