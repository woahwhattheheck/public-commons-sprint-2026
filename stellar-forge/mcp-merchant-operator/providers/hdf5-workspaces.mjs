// MIT. Source-owned HDF5 provider; the ordinary merchant registry composes this contribution.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {hdf5WorkspaceTools} from '../catalog/hdf5-workspace.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'hdf5-workspaces',family:'hdf5Workspaces',title:'HDF5 array workspaces',
  order:490,catalogOrder:490,configKey:'hdf5Workspaces',summary:true,dependencies:[],maxRequestBytes:1048576,
  concurrency:'provider',shutdown:'drain',
  configuration:{input:'hdf5WorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('../hdf5-workspace.mjs')).readHdf5WorkspaceConfiguration(hostPath(value))},
  tools:hdf5WorkspaceTools,load:()=>import('../hdf5-workspace.mjs'),
  create:(module,config)=>new module.MerchantHdf5Workspaces(config),
  initialize:async options=>(await import('../hdf5-workspace.mjs')).initializeHdf5Merchant(options),
  instructions:[{order:490,prefix:'merchant_hdf5_',text:'Use the original configured workspace and retain source versions, selections and operation IDs. Exact integers, byte strings, datatypes and coordinates stay in typed results. Source import is scoped to host input roots. Read an original operation after an uncertain reply and resume that same request. Cancellation stops queued/native work before adoption; committing operations must be reconciled. Publisher and buyer tools use the original dataset release/session guards and configured payer. No synthetic HDF5/CF values or invented payment receipt is produced.'}]
});
