// MIT. Continue only the completed original HTTP customer's existing workspaces.
import { access, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCanadaBuysServer } from '../../../server.mjs';
import { CanadaBuysClient } from '../../../client.mjs';
import { operateApm2BidderResponse } from './operate.mjs';

const root = process.env.CANADABUYS_CASE_ROOT;
if (!root) throw new Error('Set CANADABUYS_CASE_ROOT to the original retained customer.');
const directory = resolve(root);
const previous = JSON.parse(await readFile(join(directory,'case-result.json'),'utf8'));
if (previous.operation !== 'SCF-CANADABUYS-PROCUREMENT-9FCD-20261012' ||
    previous.operator?.status !== 'completed' || !previous.operator.saved?.workshare?.id ||
    !previous.operator.receiving?.sourceMatches) {
  throw new Error('Finish the same original HTTP/source/package customer before its bidder response continuation.');
}
await Promise.all([
  access(join(directory,'operator-workspace/workspace.sqlite')),
  access(join(directory,'receiving-workspace/workspace.sqlite'))
]);
const ownership = join(directory,'apm2-bidder-response.lock');
const lock = await open(ownership,'wx',0o600);
await lock.writeFile(JSON.stringify({pid:process.pid,operation:previous.operation,createdAt:new Date().toISOString()})+'\n');
let server, receiving;
try {
  server = await startCanadaBuysServer({directory:join(directory,'operator-workspace'),operator:'TJLabs response engineering'});
  receiving = await startCanadaBuysServer({directory:join(directory,'receiving-workspace'),operator:'TJLabs response receiving'});
  const expectedWorkspaceId = previous.operator.saved.workshare.workspaceId ||
    previous.stages.find(item=>item.stage==='reopen-original-customer')?.operator?.id;
  const expectedReceivingWorkspaceId = previous.operator.receiving.after?.id ||
    previous.operator.receiving.before?.id ||
    previous.stages.find(item=>item.stage==='reopen-original-customer')?.receiver?.id;
  if (!expectedWorkspaceId || !expectedReceivingWorkspaceId ||
      server.workspace.metadata().id !== expectedWorkspaceId ||
      receiving.workspace.metadata().id !== expectedReceivingWorkspaceId) {
    throw new Error('The original HTTP result must identify both existing workspaces.');
  }
  const result = await operateApm2BidderResponse({
    client:new CanadaBuysClient(server.url),receivingClient:new CanadaBuysClient(receiving.url),
    expectedWorkspaceId,expectedReceivingWorkspaceId,
    workshareId:previous.operator.saved.workshare.id,
    outputDirectory:join(directory,'apm2-bidder-response')
  });
  const path = join(directory,'apm2-bidder-response-result.json'), temporary = path+'.'+randomUUID()+'.tmp';
  const file = await open(temporary,'wx',0o600);
  try {
    await file.writeFile(JSON.stringify(result,null,2)+'\n'); await file.sync(); await file.close(); await rename(temporary,path);
  } catch (error) { await file.close().catch(()=>{}); await unlink(temporary).catch(()=>{}); throw error; }
  console.log(JSON.stringify({operation:previous.operation,stage:'apm2-bidder-response',status:result.status,...result.summary}));
} finally {
  if (server) await server.close().catch(()=>{});
  if (receiving) await receiving.close().catch(()=>{});
  await lock.close().catch(()=>{}); await unlink(ownership).catch(()=>{});
}
