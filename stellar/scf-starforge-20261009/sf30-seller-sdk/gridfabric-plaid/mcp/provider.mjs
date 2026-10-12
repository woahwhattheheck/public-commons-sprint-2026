// MIT. Source-owned GridFabric provider in the maintained merchant host.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {gridFabricMerchantTools} from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'gridfabric-plaid',family:'gridFabricWorkspaces',
  title:'GridFabric Plaid operations',order:640,catalogOrder:640,
  configKey:'gridFabricWorkspaces',summary:true,dependencies:[],maxRequestBytes:64*1024*1024,
  configuration:{input:'gridFabricWorkspaceConnection',privateExports:false,
    read:async(value,{hostPath})=>(await import('./workspace.mjs')).readGridFabricWorkspaceConfiguration(hostPath(value))},
  tools:gridFabricMerchantTools,
  instructions:[{prefix:'merchant_gridfabric_',order:140,text:
    'Attach a host-declared original GridFabric workspace and inspect its native state, source and complete Plaid contracts. Read domain and host pages through next_offset until null; each page reflects its native read time. Supply the caller-retained request_id and reviewed expected_revision on every domain action, management/device dispatch and portable export. Recover a lost action reply through operation for the same UUID, and recover portable exports through their original export journal. The existing native operator owns callbacks, mappings, reports, pending dispatches and SQLite. Source uploads stream reviewed host-declared files into its original immutable vault. Read complete files and exports through full manifests and exact byte ranges; the native portable export supplies the atomic workspace snapshot. Receive archives only into declared sibling workspaces with the original request UUID. Reopen borrows the same workspace after its managed restart. Closing this borrower drains its HTTP requests; managed lifecycle belongs to the selected original application.'}],
  load:()=>import('./workspace.mjs'),
  create:(module,config)=>new module.MerchantGridFabricWorkspaces(config),
  initialize:async options=>(await import('./setup.mjs')).initializeGridFabricMerchant(options)
});
