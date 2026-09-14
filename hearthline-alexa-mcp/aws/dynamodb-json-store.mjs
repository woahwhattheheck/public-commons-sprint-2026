import { signAwsRequest } from './sigv4.mjs';

const EMPTY = Object.freeze({ version: 1, missions: {}, inventory: {}, outbox: [], receipts: [] });
const clone = (value) => structuredClone(value);
const MAX_STATE_BYTES = 300 * 1024;

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
      credentials: this.credentials,
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
