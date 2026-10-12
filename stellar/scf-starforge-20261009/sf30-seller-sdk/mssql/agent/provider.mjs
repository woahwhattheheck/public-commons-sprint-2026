// MIT. Source-owned declaration; the original SQL Server browser retains native ownership.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { mssqlWorkspaceTools } from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'mssql-workspaces',family:'mssqlWorkspaces',
  title:'SQL Server merchant workspaces',order:690,catalogOrder:690,configKey:'mssqlWorkspaces',
  configuration:{input:'mssqlWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./client.mjs')).readMssqlWorkspaceConfiguration(hostPath(value))},
  tools:mssqlWorkspaceTools,maxRequestBytes:524288,concurrency:'provider',
  load:()=>import('./client.mjs'),
  create:(module,config)=>new module.MerchantMssqlWorkspaces(config),
  initialize:options=>import('./setup.mjs').then(module=>module.initializeMssqlWorkspaceMerchant(options)),
  instructions:[{order:690,prefix:'merchant_mssql_',text:
    'Use the original SQL Server workspace alias and workspaceId on every call. Its existing authenticated browser owns catalog reads, typed query execution, immutable prepared releases and seller runs. Review actual table metadata, retain the exact choices and operation UUID, then preview and prepare. On an interrupted review/preview/prepare/export/receive reply, repeat the same operation UUID and unchanged arguments. A changed source or schema requires a fresh review. Customer exports contain only the original public client/OpenAPI; merchant exports contain approved private SQL/connection references and complete source. Download every retained file with mssql-download, then receive through a host-declared directory alias. The original SF82 tools own release activation and managed settlement.'}]
});
