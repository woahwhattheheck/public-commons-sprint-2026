// MIT. One original Store/lease and listener for commissioning and field work.
import { openCentralWorkspace } from '../workspace.mjs';
import { createCentralServer } from '../server.mjs';
import { fault } from '../../odata/state.mjs';
import { createCentralCommissioning } from './model.mjs';
import { createCommissioningExtension } from './extension.mjs';

export async function openCentralCommissioning({directory,connection,fetchImpl=globalThis.fetch}={}) {
  let commissioning=null,workspace=null,closed=false;
  try{
    workspace=await openCentralWorkspace({directory,fetchImpl,
      extend:({workspace:owner,store})=>{commissioning=createCentralCommissioning({workspace:owner,store,connection,fetchImpl});}});
    if(!commissioning)throw fault('CENTRAL_COMMISSIONING_EXTENSION_MISSING',
      'Use the complete Central source with its original trusted Store extension callback.');
    return {workspace,commissioning,
      extension:createCommissioningExtension({workspace,commissioning}),
      async close(){if(closed)return;closed=true;try{await commissioning.close();}finally{await workspace.close();}}};
  }catch(error){try{await commissioning?.close();}finally{await workspace?.close();}throw error;}
}
/** Direct source entry. A managed host composes extension on its existing server. */
export async function serveCentralCommissioning({directory,connection,host='127.0.0.1',port=0,token,fetchImpl=globalThis.fetch}={}) {
  const owner=await openCentralCommissioning({directory,connection,fetchImpl});let server=null,closed=false;
  try{
    server=await createCentralServer({workspace:owner.workspace,host,port,...(token?{token}:{}),extensions:[owner.extension]});
    // A complete original server must actually mount the supplied extension.
    const response=await fetch(server.origin+'/api/commissioning/state',
      {headers:{Authorization:'Bearer '+server.token},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw fault('CENTRAL_COMMISSIONING_HTTP_EXTENSION','Install the original Central server extension postimage before opening commissioning.');
    const actual=await response.json(),state=owner.commissioning.state();
    if(actual.schema!==state.schema||actual.workspaceId!==state.workspaceId)
      throw fault('CENTRAL_COMMISSIONING_HTTP_IDENTITY','The original listener returned another workspace.');
    return {schema:'stellar-forge.central-commissioning-listener.v1',workspaceId:state.workspaceId,
      directory:owner.workspace.directory,origin:server.origin,
      url:server.origin+'/commissioning/#token='+encodeURIComponent(server.token),
      fieldWorkspaceUrl:server.url,token:server.token,
      workspace:owner.workspace,commissioning:owner.commissioning,
      async close(){if(closed)return;closed=true;try{await server.close();}finally{await owner.close();}}};
  }catch(error){try{await server?.close();}finally{await owner.close();}throw error;}
}
