// MIT. Optional direct opening; managed hosts mount these models on their current owner.
import { openCentralWorkspace } from '../workspace.mjs';
import { createCentralServer } from '../server.mjs';
import { createCentralCommissioning } from '../commissioning/model.mjs';
import { createCommissioningExtension } from '../commissioning/extension.mjs';
import { fault } from '../../odata/state.mjs';
import { createCentralWarehouse } from './model.mjs';
import { createWarehouseExtension } from './extension.mjs';

export async function openCentralWarehouse({directory,connection,profiles=[],fetchImpl=globalThis.fetch}={}) {
  let workspace=null,commissioning=null,warehouse=null,closed=false;
  try {
    workspace=await openCentralWorkspace({directory,fetchImpl,extend:({workspace:original,store})=>{
      commissioning=createCentralCommissioning({workspace:original,store,connection,fetchImpl});
      warehouse=createCentralWarehouse({workspace:original,store,profiles});
    }});
    if(!warehouse||!commissioning)throw fault('CENTRAL_WAREHOUSE_EXTENSION_MISSING',
      'Use the complete original Central source with its trusted Store extension callback.');
    const extensions=[createCommissioningExtension({workspace,commissioning}),createWarehouseExtension({workspace,warehouse})];
    return {workspace,commissioning,warehouse,extensions,
      async close(){if(closed)return;closed=true;
        try{await warehouse.close();}finally{try{await commissioning.close();}finally{await workspace.close();}}}};
  }catch(error){
    try{await warehouse?.close();}finally{try{await commissioning?.close();}finally{await workspace?.close();}}
    throw error;
  }
}
export async function serveCentralWarehouse({directory,connection,profiles=[],host='127.0.0.1',port=0,token,fetchImpl=globalThis.fetch}={}) {
  const owner=await openCentralWarehouse({directory,connection,profiles,fetchImpl});
  let server=null,closed=false;
  try {
    server=await createCentralServer({workspace:owner.workspace,host,port,...(token?{token}:{}),extensions:owner.extensions});
    const response=await fetch(server.origin+'/api/warehouse/state',{redirect:'error',
      signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+server.token}});
    const state=response.ok?await response.json():null;
    if(state?.schema!=='stellar-forge.central-warehouse.v1'||state.workspaceId!==owner.workspace.state().id)
      throw fault('CENTRAL_WAREHOUSE_HTTP_EXTENSION','Mount the complete original warehouse extension on this same listener before use.');
    return {schema:'stellar-forge.central-warehouse-listener.v1',workspaceId:state.workspaceId,
      directory:owner.workspace.directory,origin:server.origin,token:server.token,
      url:server.origin+'/warehouse/#token='+encodeURIComponent(server.token),
      fieldWorkspaceUrl:server.url,
      commissioningUrl:server.origin+'/commissioning/#token='+encodeURIComponent(server.token),
      ...owner,
      async close(){if(closed)return;closed=true;try{await server.close();}finally{await owner.close();}}};
  }catch(error){try{await server?.close();}finally{await owner.close();}throw error;}
}
