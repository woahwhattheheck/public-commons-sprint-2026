// MIT. Retained RPC plans through the original SF30 compiler and provider lifecycle.
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { absolute, readPrivateFile, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { prepareProduct, credentialReferences } from '../sf30-seller-sdk/jsonrpc/config.mjs';
import { createStellarRpcApplication } from '../sf30-seller-sdk/jsonrpc/application.mjs';
import { admitRequest } from '../sf30-seller-sdk/jsonrpc/stellar.mjs';
import { retainInitializationFile } from '../sf88-operator-buyer-cli/initialization.mjs';

const LIMIT = 131072;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};

/** Compile public declarations offline; provider values remain in the launch environment. */
export async function readJsonrpcCommerce(file, { expectedConfig, expectedSha256,
  allowLoopback = false } = {}) {
  absolute(file);
  need(typeof allowLoopback === 'boolean', 'COMMERCE_JSONRPC_LOOPBACK_INVALID');
  const sourceBytes = await readPrivateFile(file, LIMIT), sha256 = sha(sourceBytes);
  need(expectedSha256 === undefined || sha256 === expectedSha256, 'COMMERCE_JSONRPC_PLAN_CHANGED');
  let prepared;
  try { prepared = prepareProduct(parseJson(sourceBytes)); }
  catch { throw Object.assign(new Error('COMMERCE_JSONRPC_PLAN_INVALID'), { code: 'COMMERCE_JSONRPC_PLAN_INVALID' }); }
  need(expectedConfig === undefined || isDeepStrictEqual(prepared.service, expectedConfig),
    'COMMERCE_JSONRPC_OFFERS_CHANGED');
  return { file, sourceBytes, sha256, plan: prepared.plan, service: prepared.service, allowLoopback };
}

export async function retainJsonrpcCommerce(file, reviewed, { resume = false } = {}) {
  absolute(file);
  need(Buffer.isBuffer(reviewed?.sourceBytes) && sha(reviewed.sourceBytes) === reviewed.sha256,
    'COMMERCE_JSONRPC_PLAN_CHANGED');
  await retainInitializationFile(file, reviewed.sourceBytes, { resume });
  return { file, sha256: reviewed.sha256 };
}

export function describeJsonrpcCommerce(reviewed) {
  if (!reviewed) return null;
  return { sha256: reviewed.sha256, dataNetwork: reviewed.plan.dataNetwork,
    paymentNetwork: reviewed.plan.payment.network,
    methods: reviewed.plan.operations.map(row => row.method),
    credentialEnvironment: credentialReferences(reviewed.plan),
    allowLoopback: reviewed.allowLoopback };
}

export function validateJsonrpcCommerceRequest(reviewed, method, context) {
  need(reviewed.plan.operations.some(row => row.method === method), 'COMMERCE_JSONRPC_METHOD_NOT_SELECTED');
  const admitted = admitRequest(method, context, reviewed.plan.limits);
  need(admitted === true, admitted?.body?.error ?? 'COMMERCE_JSONRPC_INPUT_INVALID');
}

/** Every session owns a fresh original provider; a generated module is never cached. */
export async function openJsonrpcCommerce(file, { expectedConfig, expectedSha256,
  allowLoopback = false, environment = process.env } = {}) {
  const reviewed = await readJsonrpcCommerce(file, { expectedConfig, expectedSha256, allowLoopback });
  const application = createStellarRpcApplication(reviewed.plan, {
    env: { ...environment }, allowLoopbackUpstream: reviewed.allowLoopback,
  });
  try { await application.verifyNetwork(); }
  catch (error) { await application.close().catch(() => {}); throw error; }
  return application;
}

