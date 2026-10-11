// MIT — Real LangChain ToolMessages retain original response artifacts.
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BuyerAgent, summarizeOutcome } from './operation.mjs';
import { need } from '../store.mjs';

function toolResponse(artifact, limit) {
  const serialized = JSON.stringify(artifact);
  if (serialized.length <= limit) return [serialized, artifact];
  const summary = { intentId: artifact.binding?.intentId ?? null,
    configSha256: artifact.binding?.configSha256 ?? null, phase: artifact.phase ?? null,
    nativeStatus: artifact.result?.nativeStatus ?? null, httpStatus: artifact.result?.httpStatus ?? null,
    format: artifact.format ?? null,
    records: artifact.records ?? null, partial: artifact.partial ?? false,
    previewTruncated: true, artifactIncludesRequestedData: true };
  const preview = JSON.stringify(artifact.data ?? artifact.review ?? null);
  let low = 0, high = Math.min(preview.length, limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify({ ...summary, previewText: preview.slice(0, middle) }).length <= limit) low = middle;
    else high = middle - 1;
  }
  return [JSON.stringify({ ...summary, previewText: preview.slice(0, low) }), artifact];
}

/** Return four standard tools bound to one operation selected by the application. */
export function createBuyerTools({ operation, namePrefix = 'stellar_buyer',
  maxContentCharacters = 16000, readDefaults = {} }) {
  need(typeof namePrefix === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(namePrefix), 'AGENT_TOOL_NAME_INVALID');
  need(Number.isSafeInteger(maxContentCharacters) && maxContentCharacters >= 1024,
    'AGENT_TOOL_CONTENT_LIMIT_INVALID');
  const agent = new BuyerAgent(operation);
  const empty = z.object({}).strict();
  const readSchema = z.object({
    format: z.enum(['file', 'json', 'text', 'base64', 'csv', 'sse', 'ndjson']).optional(),
    limitBytes: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    limitRecords: z.number().int().nonnegative().optional(),
    allowPartial: z.boolean().optional(),
    maxRecordBytes: z.number().int().positive().optional(),
    maxRecords: z.number().int().positive().optional(),
    headers: z.boolean().optional(),
  }).strict();
  const make = (suffix, description, schema, run) => tool(async (input, config) =>
    toolResponse(await run(input, config), maxContentCharacters),
  { name: `${namePrefix}_${suffix}`, description, schema, responseFormat: 'content_and_artifact' });
  return [
    make('review', 'Run the original offline review for this bound Stellar operation. Retains the original review for execute.',
      empty, async () => ({ binding: await agent.binding(), review: await agent.review(), phase: 'reviewed' })),
    make('execute', 'Execute this already reviewed, application-selected Stellar operation. Recovers an existing result or attempt; repeated calls never create a second native attempt.',
      empty, async (_input, config) => summarizeOutcome(await agent.execute({ signal: config?.signal }))),
    make('recover', 'Read this original Stellar operation and retained native result after a restart or interruption.',
      empty, async () => summarizeOutcome(await agent.recover())),
    make('read', 'Verify and read the retained response for this Stellar operation. File metadata, JSON, text, CSV, SSE and NDJSON are supported. Record pages are returned after full source verification.',
      readSchema, async (input, config) => agent.read({ ...readDefaults, ...input, signal: config?.signal })),
  ];
}
