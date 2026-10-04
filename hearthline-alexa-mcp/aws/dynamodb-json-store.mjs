import { signAwsRequest } from './sigv4.mjs';

const EMPTY = Object.freeze({ version: 1, missions: {}, inventory: {}, outbox: [], receipts: [] });
const clone = (value) => structuredClone(value);
const MAX_STATE_BYTES = 300 * 1024;
const ECS_CREDENTIALS_ORIGIN = 'http://169.254.170.2';
const ECS_CREDENTIALS_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,1024}$/;

function required(value, label) {
  if (!value || !String(value).trim()) throw new Error(`${label} is required`);
  return String(value).trim();
}

function parseJsonSafe(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function validateState(value) {
  if (!value || value.version !== 1 || typeof value.missions !== 'object' || Array.isArray(value.missions)) {
    throw new Error('unsupported Hearthline store format');
  }
  return {
    ...clone(EMPTY),
    ...value,
    missions: value.missions ?? {},
    inventory: value.inventory ?? {},
    outbox: value.outbox ?? [],
    receipts: value.receipts ?? [],
  };
}

function encodeState(state) {
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) throw new Error(`Hearthline state exceeds ${MAX_STATE_BYTES} bytes`);
  return json;
}

export class DynamoDbJsonStore {
  constructor({ tableName, region, credentials, key = 'hearthline', endpoint, fetchImpl = globalThis.fetch, clock = () => new Date() }) {
    this.tableName = required(tableName, 'DynamoDB table name');
    this.region = required(region, 'AWS region');
    this.key = required(key, 'DynamoDB partition key value');
    if (!credentials || (typeof credentials !== 'object' && typeof credentials !== 'function')) throw new Error('AWS credentials or credential provider is required');
    this.credentials = credentials;
    this.endpoint = endpoint ?? `https://dynamodb.${this.region}.amazonaws.com/`;
    const parsedEndpoint = new URL(this.endpoint);
    if (parsedEndpoint.protocol !== 'https:') throw new Error('DynamoDB endpoint must use https');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.nativeNetworkTransport = fetchImpl === globalThis.fetch;
    this.clock = clock;
    this.state = clone(EMPTY);
    this.revision = null;
    this.loaded = false;
    this.writeChain = Promise.resolve();
    this.lastEvidence = null;
  }

  async load() {
    if (this.loaded) return;
    const item = await this.#getItem();
    if (item) {
      this.state = validateState(JSON.parse(item.state.S));
      this.revision = Number(item.revision.N);
      if (!Number.isSafeInteger(this.revision) || this.revision < 0) throw new Error('invalid DynamoDB store revision');
      this.loaded = true;
      return;
    }
    try {
      await this.#putState(clone(EMPTY), 0, { initialize: true });
      this.state = clone(EMPTY);
      this.revision = 0;
      this.loaded = true;
    } catch (error) {
      if (error?.code !== 'ConditionalCheckFailedException') throw error;
      const raced = await this.#getItem();
      if (!raced) throw new Error('DynamoDB initialization raced but no item became visible');
      this.state = validateState(JSON.parse(raced.state.S));
      this.revision = Number(raced.revision.N);
      this.loaded = true;
    }
  }

  snapshot() { return clone(this.state); }

  async mutate(fn) {
    if (typeof fn !== 'function') throw new Error('mutate callback is required');
    let resolveChain;
    const turn = new Promise((resolve) => { resolveChain = resolve; });
    const prior = this.writeChain;
    this.writeChain = prior.then(() => turn, () => turn);
    await prior;
    try {
      await this.load();
      const draft = clone(this.state);
      const result = await fn(draft);
      const nextRevision = this.revision + 1;
      await this.#putState(draft, nextRevision, { expectedRevision: this.revision });
      this.state = draft;
      this.revision = nextRevision;
      return clone(result);
    } finally {
      resolveChain();
    }
  }

  runtimeEvidence() { return this.lastEvidence ? clone(this.lastEvidence) : null; }

  async probe() {
    await this.#getItem();
    return this.runtimeEvidence();
  }

  async #getItem() {
    const response = await this.#request('DynamoDB_20120810.GetItem', {
      TableName: this.tableName,
      ConsistentRead: true,
      Key: { pk: { S: this.key } },
      ProjectionExpression: 'pk, #revision, #state',
      ExpressionAttributeNames: { '#revision': 'revision', '#state': 'state' },
    });
    return response.Item ?? null;
  }

  async #putState(state, revision, { initialize = false, expectedRevision } = {}) {
    const body = {
      TableName: this.tableName,
      Item: {
        pk: { S: this.key },
        revision: { N: String(revision) },
        state: { S: encodeState(validateState(state)) },
      },
    };
    if (initialize) {
      body.ConditionExpression = 'attribute_not_exists(pk)';
    } else {
      body.ConditionExpression = '#revision = :expected';
      body.ExpressionAttributeNames = { '#revision': 'revision' };
      body.ExpressionAttributeValues = { ':expected': { N: String(expectedRevision) } };
    }
    return this.#request('DynamoDB_20120810.PutItem', body);
  }

  async #request(target, payload) {
    const body = JSON.stringify(payload);
    const credentials = typeof this.credentials === 'function' ? await this.credentials() : this.credentials;
    if (!credentials || typeof credentials !== 'object') throw new Error('AWS credential provider returned invalid credentials');
    const signed = signAwsRequest({
      method: 'POST',
      url: this.endpoint,
      region: this.region,
      service: 'dynamodb',
      body,
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': target,
      },
      credentials,
      now: this.clock(),
    });
    const response = await this.fetchImpl(signed.url, { method: signed.method, headers: signed.headers, body: signed.body, redirect: 'error' });
    const text = await response.text();
    const decoded = parseJsonSafe(text);
    const requestId = response.headers?.get?.('x-amzn-requestid') ?? response.headers?.get?.('x-amz-request-id') ?? null;
    this.lastEvidence = {
      schemaVersion: 1,
      provider: 'aws',
      service: 'dynamodb',
      region: this.region,
      endpoint: new URL(this.endpoint).origin,
      target,
      observedAt: this.clock().toISOString(),
      httpStatus: response.status,
      requestId,
      liveAwsObservation: Boolean(this.nativeNetworkTransport && requestId && new URL(this.endpoint).hostname === `dynamodb.${this.region}.amazonaws.com`),
    };
    if (!response.ok) {
      const error = new Error(`DynamoDB ${target} failed with HTTP ${response.status}: ${decoded.message ?? decoded.Message ?? decoded.__type ?? 'request failed'}`);
      error.code = String(decoded.__type ?? decoded.code ?? '').split('#').pop() || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return decoded;
  }
}

export function awsCredentialsFromEnv(env = process.env) {
  const accessKeyId = required(env.AWS_ACCESS_KEY_ID, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = required(env.AWS_SECRET_ACCESS_KEY, 'AWS_SECRET_ACCESS_KEY');
  const sessionToken = env.AWS_SESSION_TOKEN ? String(env.AWS_SESSION_TOKEN) : undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

function normalizeRuntimeCredentials(raw, label = 'AWS runtime credentials') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} response must be an object`);
  const accessKeyId = required(raw.AccessKeyId ?? raw.accessKeyId, `${label} access key`);
  const secretAccessKey = required(raw.SecretAccessKey ?? raw.secretAccessKey, `${label} secret key`);
  const sessionToken = required(raw.Token ?? raw.sessionToken, `${label} session token`);
  const expiration = required(raw.Expiration ?? raw.expiration, `${label} expiration`);
  const expiresAt = Date.parse(expiration);
  if (!Number.isFinite(expiresAt)) throw new Error(`${label} expiration must be ISO-8601`);
  if (expiresAt <= Date.now() + 60_000) throw new Error(`${label} are expired or expire within one minute`);
  return { accessKeyId, secretAccessKey, sessionToken };
}

export async function awsCredentialsFromRuntime({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const access = String(env.AWS_ACCESS_KEY_ID ?? '').trim();
  const secret = String(env.AWS_SECRET_ACCESS_KEY ?? '').trim();
  const token = String(env.AWS_SESSION_TOKEN ?? '').trim();
  if (access || secret || token) {
    if (!access || !secret) throw new Error('static AWS credentials are incomplete');
    return awsCredentialsFromEnv(env);
  }

  const relative = String(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? '').trim();
  const full = String(env.AWS_CONTAINER_CREDENTIALS_FULL_URI ?? '').trim();
  if (full) throw new Error('AWS_CONTAINER_CREDENTIALS_FULL_URI is not accepted; ECS relative credential URI is required');
  if (!relative) throw new Error('AWS credentials are unavailable: set static environment credentials or ECS task-role AWS_CONTAINER_CREDENTIALS_RELATIVE_URI');
  if (!ECS_CREDENTIALS_PATH.test(relative) || relative.includes('..') || relative.includes('//')) throw new Error('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI is invalid');
  if (typeof fetchImpl !== 'function') throw new Error('credential fetch implementation is required');

  const url = `${ECS_CREDENTIALS_ORIGIN}${relative}`;
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(`ECS task-role credential endpoint unavailable: ${error.message}`);
  }
  if (!response?.ok) throw new Error(`ECS task-role credential endpoint returned HTTP ${response?.status ?? 'unknown'}`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('ECS task-role credential endpoint returned invalid JSON'); }
  return normalizeRuntimeCredentials(payload, 'ECS task-role credentials');
}
