import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDbJsonStore } from '../aws/dynamodb-json-store.mjs';

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' };
const response = (status, body, requestId = 'req-12345678') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get(name) { return name.toLowerCase() === 'x-amzn-requestid' ? requestId : null; } },
  async text() { return JSON.stringify(body); },
});

function mockDynamo(initial = null) {
  let item = initial;
  const calls = [];
  return {
    calls,
    fetchImpl: async (_url, init) => {
      const target = init.headers['x-amz-target'];
      const body = JSON.parse(init.body);
      calls.push({ target, body, headers: init.headers });
      if (target.endsWith('.GetItem')) return response(200, item ? { Item: item } : {});
      if (target.endsWith('.PutItem')) {
        const currentRevision = item ? Number(item.revision.N) : null;
        if (body.ConditionExpression === 'attribute_not_exists(pk)' && item) return response(400, { __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException', message: 'exists' });
        if (body.ConditionExpression === '#revision = :expected' && currentRevision !== Number(body.ExpressionAttributeValues[':expected'].N)) {
          return response(400, { __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException', message: 'stale' });
        }
        item = body.Item;
        return response(200, {});
      }
      throw new Error(`unexpected target ${target}`);
    },
    get item() { return item; },
  };
}

test('initializes once, persists state, and uses optimistic revision conditions', async () => {
  const mock = mockDynamo();
  const store = new DynamoDbJsonStore({ tableName: 'HearthlineState', region: 'us-east-1', credentials, fetchImpl: mock.fetchImpl, clock: () => new Date('2026-09-13T12:00:00Z') });
  await store.load();
  assert.equal(store.revision, 0);
  await store.mutate((state) => { state.inventory.water = 3; return { saved: true }; });
  assert.equal(store.revision, 1);
  assert.equal(store.snapshot().inventory.water, 3);
  const puts = mock.calls.filter((call) => call.target.endsWith('.PutItem'));
  assert.equal(puts.length, 2);
  assert.equal(puts[1].body.ConditionExpression, '#revision = :expected');
  assert.equal(puts[1].body.ExpressionAttributeValues[':expected'].N, '0');
  assert.equal(JSON.parse(mock.item.state.S).inventory.water, 3);
});

test('stale remote revision fails closed without mutating local state', async () => {
  const initial = { pk: { S: 'hearthline' }, revision: { N: '7' }, state: { S: JSON.stringify({ version: 1, missions: {}, inventory: {}, outbox: [], receipts: [] }) } };
  const mock = mockDynamo(initial);
  const store = new DynamoDbJsonStore({ tableName: 'HearthlineState', region: 'us-east-1', credentials, fetchImpl: mock.fetchImpl });
  await store.load();
  mock.item.revision.N = '8';
  await assert.rejects(store.mutate((state) => { state.inventory.flashlight = 1; }), (error) => error.code === 'ConditionalCheckFailedException');
  assert.equal(store.snapshot().inventory.flashlight, undefined);
  assert.equal(store.revision, 7);
});

test('injected/mock transports can never mint live AWS evidence', async () => {
  const mock = mockDynamo();
  const store = new DynamoDbJsonStore({ tableName: 'HearthlineState', region: 'us-east-1', credentials, fetchImpl: mock.fetchImpl, clock: () => new Date('2026-09-13T12:00:00Z') });
  await store.probe();
  const evidence = store.runtimeEvidence();
  assert.equal(evidence.liveAwsObservation, false);
  assert.equal(evidence.requestId, 'req-12345678');
  assert.equal(evidence.endpoint, 'https://dynamodb.us-east-1.amazonaws.com');
  const local = new DynamoDbJsonStore({ tableName: 'HearthlineState', region: 'us-east-1', credentials, endpoint: 'https://example.com/', fetchImpl: mock.fetchImpl });
  await local.probe();
  assert.equal(local.runtimeEvidence().liveAwsObservation, false);
});

test('signed transport does not put raw credentials in JSON payload', async () => {
  const mock = mockDynamo();
  const store = new DynamoDbJsonStore({ tableName: 'HearthlineState', region: 'us-east-1', credentials, fetchImpl: mock.fetchImpl });
  await store.probe();
  const body = JSON.stringify(mock.calls[0].body);
  assert.equal(body.includes(credentials.accessKeyId), false);
  assert.equal(body.includes(credentials.secretAccessKey), false);
  assert.match(mock.calls[0].headers.authorization, /Credential=AKIDEXAMPLE\//);
});
