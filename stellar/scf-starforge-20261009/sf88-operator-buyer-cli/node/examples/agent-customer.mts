// MIT — A typed customer program; runtime and state identify an existing buyer.
import { Buyer } from '../index.mjs';
import { createSqliteBuyerGraph } from '../agents/sqlite.mjs';
import { createBuyerTools } from '../agents/langchain.mjs';
import type { ResponseArtifact } from '../agents/operation.mjs';

export async function readExistingOperation(options: {
  runtimeDirectory: string; stateDirectory: string; intentId: string;
  checkpointFile: string; threadId: string;
}): Promise<ResponseArtifact | null> {
  const buyer = new Buyer({ runtimeDirectory: options.runtimeDirectory, stateDirectory: options.stateDirectory });
  const operation = buyer.operation(options.intentId);
  const session = await createSqliteBuyerGraph({ operation,
    databasePath: options.checkpointFile, read: { format: 'json' } });
  try {
    const state = await session.graph.invoke({ action: 'recover' }, {
      configurable: { thread_id: options.threadId }, durability: 'sync',
    });
    return state.artifact;
  } finally { session.close(); }
}

export async function readWithLangChain(options: {
  runtimeDirectory: string; stateDirectory: string; intentId: string; toolCallId: string;
}) {
  const buyer = new Buyer({ runtimeDirectory: options.runtimeDirectory, stateDirectory: options.stateDirectory });
  const tools = createBuyerTools({ operation: buyer.operation(options.intentId) });
  const read = tools.find(item => item.name === 'stellar_buyer_read')!;
  return read.invoke({ type: 'tool_call', id: options.toolCallId, name: read.name,
    args: { format: 'json' } });
}
