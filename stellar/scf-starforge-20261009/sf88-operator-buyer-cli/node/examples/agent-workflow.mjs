#!/usr/bin/env node
// MIT — Operate an existing buyer intent through real optional frameworks.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buyer } from '../index.mjs';
import { BuyerAgent } from '../agents/operation.mjs';

const usage = `Stellar native buyer: framework operator

  node examples/agent-workflow.mjs graph --runtime ABS --state ABS --intent ID
    --checkpoints ABS --thread ID [--action recover|review|execute]
    [--read-format file|json|text|base64|csv|sse|ndjson] [--pause-after inspect]
  node examples/agent-workflow.mjs resume --runtime ABS --state ABS --intent ID
    --checkpoints ABS --thread ID [--read-format json]
  node examples/agent-workflow.mjs status --runtime ABS --state ABS --intent ID
    --checkpoints ABS --thread ID
  node examples/agent-workflow.mjs tool --runtime ABS --state ABS --intent ID
    --tool review|execute|recover|read [--read-format json]
  node examples/agent-workflow.mjs export --runtime ABS --state ABS --intent ID
    --out ABS

All commands attach to the existing private operation. The framework checkpoint
directory must be private. graph defaults to recovery; execute is explicit.
Use the same checkpoint file and thread to resume a paused or interrupted graph.
`;

function argumentsFor(argv) {
  const [requested = 'help', ...rest] = argv;
  const command = ['--help', '-h'].includes(requested) ? 'help' : requested;
  const allowed = new Set(['runtime', 'state', 'intent', 'checkpoints', 'thread', 'action',
    'read-format', 'pause-after', 'tool', 'out', 'offset', 'limit-records', 'limit-bytes',
    'allow-partial', 'tool-call-id']);
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || !allowed.has(key) || flags[key] !== undefined ||
      rest[i + 1] === undefined) throw new Error('ARGUMENT_INVALID: ' + rest[i]);
    flags[key] = rest[i + 1];
  }
  const required = names => { for (const name of names) if (!flags[name]) throw new Error('ARGUMENT_REQUIRED: --' + name); };
  if (command !== 'help') required(['runtime', 'state', 'intent']);
  if (['graph', 'resume', 'status'].includes(command)) required(['checkpoints', 'thread']);
  if (command === 'export') required(['out']);
  if (command === 'tool') required(['tool']);
  const read = { format: flags['read-format'] ?? 'file' };
  for (const [flag, key] of [['offset', 'offset'], ['limit-records', 'limitRecords'], ['limit-bytes', 'limitBytes']])
    if (flags[flag] !== undefined) read[key] = Number(flags[flag]);
  if (flags['allow-partial'] !== undefined) {
    if (!['true', 'false'].includes(flags['allow-partial'])) throw new Error('BOOLEAN_REQUIRED: --allow-partial');
    read.allowPartial = flags['allow-partial'] === 'true';
  }
  return { command, flags, read };
}

function graphOutput(state) {
  return { binding: state.binding ?? null, action: state.action ?? null, phase: state.phase ?? null,
    outcome: state.outcome ?? null, artifact: state.artifact ?? null,
    reviewAvailable: Boolean(state.nativeReview), readOptions: state.readOptions ?? null };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, flags, read } = argumentsFor(argv);
  if (command === 'help') { process.stdout.write(usage); return; }
  const buyer = new Buyer({ runtimeDirectory: flags.runtime, stateDirectory: flags.state });
  const operation = buyer.operation(flags.intent);
  let output;
  if (['graph', 'resume', 'status'].includes(command)) {
    const { createSqliteBuyerGraph } = await import('../agents/sqlite.mjs');
    const session = await createSqliteBuyerGraph({ operation, databasePath: flags.checkpoints,
      read, interruptAfter: flags['pause-after'] ? flags['pause-after'].split(',') : [] });
    const config = { configurable: { thread_id: flags.thread }, durability: 'sync' };
    try {
      if (command === 'status') {
        const snapshot = await session.graph.getState(config);
        if (snapshot.values.binding) await new BuyerAgent(operation).binding(snapshot.values.binding);
        output = { ...graphOutput(snapshot.values), next: snapshot.next,
          checkpoint: snapshot.config.configurable?.checkpoint_id ?? null };
      } else {
        if (command === 'resume') {
          const saved = await session.graph.getState(config);
          if (!saved.values.binding) throw new Error('CHECKPOINT_NOT_FOUND');
          await new BuyerAgent(operation).binding(saved.values.binding);
        }
        const state = await session.graph.invoke(command === 'resume' ? null :
          { action: flags.action ?? 'recover' }, config);
        const snapshot = await session.graph.getState(config);
        output = { ...graphOutput(state), next: snapshot.next,
          checkpoint: snapshot.config.configurable?.checkpoint_id ?? null };
      }
    } finally { session.close(); }
  } else if (command === 'tool') {
    const { createBuyerTools } = await import('../agents/langchain.mjs');
    const tool = createBuyerTools({ operation }).find(item => item.name === 'stellar_buyer_' + flags.tool);
    if (!tool) throw new Error('TOOL_INVALID');
    const response = await tool.invoke({ type: 'tool_call', id: flags['tool-call-id'] ?? randomUUID(),
      name: tool.name, args: flags.tool === 'read' ? read : {} });
    output = { name: response.name, toolCallId: response.tool_call_id, content: response.content,
      artifact: response.artifact };
  } else if (command === 'export') {
    output = await new BuyerAgent(operation).saveAs(flags.out);
  } else throw new Error('COMMAND_INVALID');
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? error.message, name: error.name }) + '\n');
    process.exitCode = 1;
  });
