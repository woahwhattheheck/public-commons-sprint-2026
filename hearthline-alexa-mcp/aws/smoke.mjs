import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DynamoDbJsonStore, awsCredentialsFromEnv } from './dynamodb-json-store.mjs';

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const tableName = process.env.HEARTHLINE_DDB_TABLE;
const out = process.env.HEARTHLINE_AWS_EVIDENCE;
if (!region) throw new Error('AWS_REGION (or AWS_DEFAULT_REGION) is required');
if (!tableName) throw new Error('HEARTHLINE_DDB_TABLE is required');
if (!out) throw new Error('HEARTHLINE_AWS_EVIDENCE is required');

const store = new DynamoDbJsonStore({ tableName, region, key: process.env.HEARTHLINE_DDB_KEY ?? 'hearthline', credentials: awsCredentialsFromEnv() });
const evidence = await store.probe();
if (!evidence?.liveAwsObservation || evidence.httpStatus !== 200 || !evidence.requestId) throw new Error('live AWS request evidence was not established');
const payload = { ...evidence, tableName, adapter: 'hearthline-dynamodb-json-store', evidenceKind: 'live_read_probe' };
await writeFile(resolve(out), `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({ ok: true, provider: payload.provider, service: payload.service, region: payload.region, target: payload.target, httpStatus: payload.httpStatus, evidenceKind: payload.evidenceKind }));
