import test from 'node:test';
import assert from 'node:assert/strict';
import { signAwsRequest, redactAwsHeaders } from '../aws/sigv4.mjs';

test('SigV4 signing is deterministic and covers DynamoDB target/body', () => {
  const request = signAwsRequest({
    method: 'POST',
    url: 'https://dynamodb.us-east-1.amazonaws.com/',
    region: 'us-east-1',
    service: 'dynamodb',
    now: new Date('2026-09-13T12:34:56Z'),
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE', sessionToken: 'TOKENEXAMPLE' },
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'DynamoDB_20120810.GetItem' },
    body: '{"TableName":"Hearthline"}',
  });
  assert.equal(request.amzDate, '20260913T123456Z');
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260913\/us-east-1\/dynamodb\/aws4_request,/);
  assert.match(request.canonicalRequest, /x-amz-target:DynamoDB_20120810.GetItem/);
  assert.match(request.canonicalRequest, /x-amz-security-token:TOKENEXAMPLE/);
  assert.equal(request.signature.length, 64);
  assert.equal(signAwsRequest({
    method: 'POST', url: request.url, region: 'us-east-1', service: 'dynamodb', now: new Date('2026-09-13T12:34:56Z'),
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE', sessionToken: 'TOKENEXAMPLE' },
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'DynamoDB_20120810.GetItem' }, body: request.body,
  }).signature, request.signature);
});

test('redaction never exposes signing authorization or session token', () => {
  const redacted = redactAwsHeaders({ Authorization: 'secret-auth', 'X-Amz-Security-Token': 'secret-token', Host: 'example.com' });
  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted['x-amz-security-token'], '[REDACTED]');
  assert.equal(redacted.host, 'example.com');
});

test('signer rejects non-HTTPS endpoints and missing credentials', () => {
  assert.throws(() => signAwsRequest({ url: 'http://localhost/', region: 'us-east-1', service: 'dynamodb', credentials: { accessKeyId: 'a', secretAccessKey: 'b' } }), /https/);
  assert.throws(() => signAwsRequest({ url: 'https://example.com/', region: 'us-east-1', service: 'dynamodb', credentials: {} }), /access key/);
});
