// MIT. Tenderly customer preparation through the original SF88 buyer.
import { createHash } from 'node:crypto';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { inspectPlan, providerRequest, sellerConfig, ROUTE_ID, TICKET_HEADER } from './product.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { config as readConfig, operation } from '../../sf88-operator-buyer-cli/config.mjs';
import { readRequestFile, readRequestBody, requestBodyPin, writeRequestFile } from '../../sf88-operator-buyer-cli/request-body.mjs';
import { loadOperationTicket, operationTicketView, parseOperationTicketBytes } from '../../sf88-operator-buyer-cli/operation-ticket.mjs';
import { privateDirectory, jsonBytes, writeBytes, syncDirectory, intent as validateIntent } from '../../sf88-operator-buyer-cli/node/store.mjs';

export const BUYER_PREPARATION_SCHEMA = 'stellar-forge.tenderly-buyer-preparation.v1';
export const WORKSPACE_REQUEST_SCHEMA = 'stellar-forge.tenderly-workspace-request.v1';
const IMPORT_SCHEMA = 'stellar-forge.tenderly-workspace-import.v1';
const TICKET_SCHEMA = 'stellar-forge.upstream-operation-ticket.v1';
const PACKET_LIMIT = 1048576;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
function canonicalPath(value, code) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || resolve(value) !== value) fail(code);
  return value;
}
function jsonBody(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { fail('TENDERLY_REQUEST_JSON_INVALID'); }
}

/**
 * Select the original compiled offer and privately save its native buyer config.
 * The saved public request bytes are never replaced with the provider projection.
 */
export async function prepareBuyer({ plan, bodyFile, ticketFile, intentId, out,
  acceptIndex = 0, responseOut } = {}) {
  const prepared = await buyerDraft({ plan, bodyFile, ticketFile, intentId, out, acceptIndex, responseOut });
  await privateDirectory(dirname(prepared.summary.configPath));
  await writeRequestFile(prepared.summary.configPath, prepared.bytes);
  return prepared.summary;
}

async function buyerDraft({ plan, bodyFile, ticketFile, intentId, out,
  acceptIndex = 0, responseOut, requireCurrent = true }) {
  const review = inspectPlan(plan);
  const service = sellerConfig(review.plan);
  const route = service.routes.find(item => item.id === ROUTE_ID);
  const destination = canonicalPath(out, 'TENDERLY_BUYER_OUTPUT_PATH_REQUIRED');
  bodyFile = canonicalPath(bodyFile, 'TENDERLY_BUYER_BODY_PATH_REQUIRED');
  ticketFile = canonicalPath(ticketFile, 'TENDERLY_BUYER_TICKET_PATH_REQUIRED');
  if (responseOut !== undefined) canonicalPath(responseOut, 'TENDERLY_BUYER_RESPONSE_PATH_REQUIRED');
  if (new Set([destination, bodyFile, ticketFile, ...(responseOut ? [responseOut] : [])]).size !==
      3 + Number(responseOut !== undefined)) fail('TENDERLY_BUYER_FILES_MUST_BE_DISTINCT');
  const raw = await readRequestFile(bodyFile);
  const body = jsonBody(raw);
  // One contract owns address, block, input, gas and exact uint256 validation.
  providerRequest(review.plan, body);
  const bodyPin = requestBodyPin(raw);
  const catalog = jsonBytes({ resources: [route.offer] });
  const prepared = prepareReview(catalog, {
    rowIndex: 0, acceptIndex, intentId, url: review.route.url, method: review.route.method,
    bodyFile, ...bodyPin, headers: { 'Content-Type': 'application/json' },
    ticketFile, ticketHeader: TICKET_HEADER,
    ...(responseOut === undefined ? {} : { responseOut }),
  });
  const ticket = await loadOperationTicket(prepared.draft.operation, { requireCurrent });
  // Use the merchant's existing request deadline, including its original wait.
  // The original SF88 config validator owns the accepted timeout range.
  prepared.draft.requestTimeoutMs = service.requestTimeoutMs;
  if (prepared.draft.responseFile) {
    prepared.draft.responseFile.maxBytes = review.limits.maxResponseBytes;
    prepared.draft.responseFile.timeoutMs = Math.max(30000, review.limits.timeoutMs);
  }
  const bytes = jsonBytes(prepared.draft);
  if (bytes.length > 65536) fail('TENDERLY_BUYER_CONFIG_TOO_LARGE');
  return { bytes, summary: {
    schema: BUYER_PREPARATION_SCHEMA, mode: 'OFFLINE_CONFIG_PREPARED',
    configPath: destination, configSha256: sha(bytes), planSha256: review.planSha256,
    routeId: ROUTE_ID, intentId, sellerUrl: review.route.url, method: review.route.method,
    networkId: review.networkId, simulationType: review.simulationType,
    blockNumber: body.block_number, transactionIndex: body.transaction_index,
    acceptedTerms: prepared.draft.operation.expect, ...bodyPin,
    requestTimeoutMs: service.requestTimeoutMs,
    operationTicket: operationTicketView(ticket),
    sourceFileSha256: prepared.draft.preparedFrom.discoveryFileSha256,
    ...(prepared.draft.responseFile ? { responseFile: prepared.draft.responseFile } : {}),
  } };
}

function workspaceInput(packet, review, ticketFile, requireCurrent) {
  const keys = ['schema', 'profile', 'planSha256', 'merchant', 'payment', 'body', 'operation', 'customer'];
  if (!plain(packet) || Object.keys(packet).length !== keys.length ||
      Object.keys(packet).some(key => !keys.includes(key)) || packet.schema !== WORKSPACE_REQUEST_SCHEMA)
    fail('TENDERLY_WORKSPACE_REQUEST_REQUIRED');
  if (packet.planSha256 !== review.planSha256 ||
      packet.profile !== 'p-' + sha(jsonBytes(review.plan)) ||
      !isDeepStrictEqual(packet.merchant, review.route) ||
      !isDeepStrictEqual(packet.payment, review.payment))
    fail('TENDERLY_WORKSPACE_PLAN_MISMATCH');
  providerRequest(review.plan, packet.body);
  if (!plain(packet.customer) || Object.keys(packet.customer).length !== 2 ||
      Object.keys(packet.customer).some(key => !['id', 'subject'].includes(key)) ||
      ![packet.customer.id, packet.customer.subject].every(value =>
        typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)))
    fail('TENDERLY_WORKSPACE_CUSTOMER_REQUIRED');
  const operationKeys = ['schema', 'ticket', 'operationKey', 'requestHash', 'expiresAt'];
  if (!plain(packet.operation) || Object.keys(packet.operation).length !== operationKeys.length ||
      Object.keys(packet.operation).some(key => !operationKeys.includes(key)))
    fail('TENDERLY_WORKSPACE_OPERATION_REQUIRED');
  if (packet.operation.schema !== TICKET_SCHEMA) fail('TENDERLY_WORKSPACE_OPERATION_REQUIRED');
  const ticketBytes = jsonBytes(packet.operation);
  const ticket = parseOperationTicketBytes(ticketBytes, {
    method: review.route.method, ticketFile, ticketHeader: TICKET_HEADER,
  }, { requireCurrent });
  return { bodyBytes: jsonBytes(packet.body), ticketBytes, ticket };
}

async function retained(path, limit = PACKET_LIMIT) {
  try { return await readRequestFile(path, limit, { privateFile: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function retainExact(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await retained(path, bytes.length);
    if (!existing?.equals(bytes)) fail('TENDERLY_WORKSPACE_IMPORT_FILE_CHANGED');
  }
}

/**
 * Import the workspace's private download on this customer machine. The same
 * packet can resume an interrupted import; native buyer state is a separate
 * application directory and owns every subsequent attempt and result.
 */
export async function prepareWorkspaceRequest({ plan, packetFile, intentId, out,
  acceptIndex = 0, responseOut } = {}) {
  const review = inspectPlan(plan);
  const directory = canonicalPath(out, 'TENDERLY_WORKSPACE_OUTPUT_DIRECTORY_REQUIRED');
  packetFile = canonicalPath(packetFile, 'TENDERLY_WORKSPACE_PACKET_PATH_REQUIRED');
  const paths = Object.fromEntries(['workspace-request.json', 'plan.json', 'simulation.json',
    'merchant-ticket.json', 'buyer.json', 'import.json', 'prepared.json']
    .map(name => [name, join(directory, name)]));
  if (Object.values(paths).includes(packetFile) || responseOut !== undefined &&
      (Object.values(paths).includes(responseOut) || responseOut === packetFile))
    fail('TENDERLY_BUYER_FILES_MUST_BE_DISTINCT');
  const packetBytes = await readRequestFile(packetFile, PACKET_LIMIT, { privateFile: true });
  const packet = jsonBody(packetBytes);
  const binding = { schema: IMPORT_SCHEMA, packetSha256: sha(packetBytes),
    planSha256: review.planSha256, intentId, acceptIndex, responseOut: responseOut ?? null };
  const marker = jsonBytes(binding);
  const completedBytes = await retained(paths['prepared.json'], 65536);
  const completed = completedBytes === null ? null : jsonBody(completedBytes);
  if (completed !== null && (completed.schema !== IMPORT_SCHEMA + '.complete' ||
      !isDeepStrictEqual(completed.input, binding))) fail('TENDERLY_WORKSPACE_IMPORT_CONFLICT');
  const input = workspaceInput(packet, review, paths['merchant-ticket.json'], completed === null);
  // The original buyer owns stable intent validation and all payment terms.
  validateIntent(intentId);
  if (acceptIndex !== 0) fail('TENDERLY_SINGLE_OFFER_SELECTION_REQUIRED');
  if (responseOut !== undefined) canonicalPath(responseOut, 'TENDERLY_BUYER_RESPONSE_PATH_REQUIRED');
  const files = { 'import.json': marker, 'workspace-request.json': packetBytes,
    'plan.json': jsonBytes(review.plan), 'simulation.json': input.bodyBytes,
    'merchant-ticket.json': input.ticketBytes };
  await privateDirectory(directory);
  if (await realpath(directory) !== directory) fail('TENDERLY_WORKSPACE_CANONICAL_DIRECTORY_REQUIRED');
  const names = await readdir(directory);
  const responseName = responseOut && dirname(responseOut) === directory ? responseOut.slice(directory.length + 1) : null;
  if (names.some(name => !Object.hasOwn(paths, name) && name !== responseName) ||
      names.length > 0 && !names.includes('import.json')) fail('TENDERLY_WORKSPACE_IMPORT_DIRECTORY_CONFLICT');
  for (const [name, bytes] of Object.entries(files)) {
    const existing = await retained(paths[name], bytes.length);
    if (existing !== null && !existing.equals(bytes)) fail('TENDERLY_WORKSPACE_IMPORT_FILE_CHANGED');
  }
  for (const [name, bytes] of Object.entries(files)) await retainExact(paths[name], bytes);
  const prepared = await buyerDraft({ plan: review.plan, bodyFile: paths['simulation.json'],
    ticketFile: paths['merchant-ticket.json'], intentId, out: paths['buyer.json'], acceptIndex,
    responseOut, requireCurrent: completed === null });
  const manifest = { schema: IMPORT_SCHEMA + '.complete', input: binding,
    configSha256: prepared.summary.configSha256,
    files: Object.fromEntries(Object.entries({ ...files, 'buyer.json': prepared.bytes })
      .map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha(bytes) }])) };
  const manifestBytes = jsonBytes(manifest);
  if (completedBytes !== null && !completedBytes.equals(manifestBytes)) fail('TENDERLY_WORKSPACE_IMPORT_FILE_CHANGED');
  await retainExact(paths['buyer.json'], prepared.bytes);
  await retainExact(paths['prepared.json'], manifestBytes);
  await syncDirectory(directory);
  return { ...prepared.summary, directory, packetSha256: sha(packetBytes), profile: packet.profile,
    customer: packet.customer,
    planFile: paths['plan.json'], packetFile: paths['workspace-request.json'],
    manifestPath: paths['prepared.json'], reopened: completed !== null };
}

/** Read the same native input and ticket references before customer import. */
export async function readBuyerPreparation({ configFile } = {}) {
  configFile = canonicalPath(configFile, 'TENDERLY_BUYER_CONFIG_PATH_REQUIRED');
  const raw = await readRequestFile(configFile, 65536, { privateFile: true });
  const config = await readConfig(configFile);
  if (sha(await readRequestFile(configFile, 65536, { privateFile: true })) !== sha(raw))
    fail('TENDERLY_BUYER_CONFIG_CHANGED_DURING_READ');
  const op = operation(config.operation);
  if (op.method !== 'POST' || op.bodyFile === undefined || op.ticketFile === undefined ||
      op.ticketHeader !== TICKET_HEADER || config.preparedFrom === undefined)
    fail('TENDERLY_PREPARED_BUYER_CONFIG_REQUIRED');
  const body = await readRequestBody(op);
  const ticket = await loadOperationTicket(op);
  return { schema: BUYER_PREPARATION_SCHEMA, configPath: configFile,
    configSha256: sha(raw), intentId: op.intentId, sellerUrl: op.url, method: op.method,
    acceptedTerms: op.expect, ...requestBodyPin(body),
    operationTicket: operationTicketView(ticket),
    requestTimeoutMs: config.requestTimeoutMs ?? 30000,
    ...(config.responseFile ? { responseFile: config.responseFile } : {}) };
}
