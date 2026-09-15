import { DynamoDbJsonStore, awsCredentialsFromEnv } from './dynamodb-json-store.mjs';
import { fetchActiveAlerts } from '../src/nws.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';
import { createMcpHttpServer } from '../src/mcp-server.mjs';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const tableName = process.env.HEARTHLINE_DDB_TABLE;
const key = process.env.HEARTHLINE_DDB_KEY ?? 'hearthline';
const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);

if (!region) throw new Error('AWS_REGION (or AWS_DEFAULT_REGION) is required');
if (!tableName) throw new Error('HEARTHLINE_DDB_TABLE is required');
const store = new DynamoDbJsonStore({ tableName, region, key, credentials: awsCredentialsFromEnv() });
await store.load();
const orchestrator = new HearthlineOrchestrator({ store, alertProvider: (location) => fetchActiveAlerts(location) });
const server = createMcpHttpServer({ orchestrator, allowedOrigins });
server.listen(port, host, () => console.log(`Hearthline MCP (AWS DynamoDB store) listening on http://${host}:${port}/mcp (protocol 2025-11-25)`));
