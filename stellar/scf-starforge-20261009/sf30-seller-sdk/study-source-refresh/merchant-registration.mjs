// MIT. Source-owned registration for the original Study application and property research.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { studyWorkspaceTools } from './agent-contracts.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'study-workspaces',family:'studyWorkspaces',
  title:'Study source refresh and property research',configKey:'studyWorkspaces',order:900,catalogOrder:900,
  configuration:{input:'studyWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./agent-setup.mjs')).readStudyWorkspaceConfiguration(hostPath(value))},
  tools:()=>studyWorkspaceTools,load:()=>import('./merchant-provider.mjs'),
  create:(module,config)=>new module.MerchantStudyWorkspaces(config),
  initialize:async options=>(await import('./agent-setup.mjs')).initializeStudyWorkspaceMerchant(options),
  maxRequestBytes:4*1024*1024+128*1024,concurrency:'provider',shutdown:'drain',
  instructions:[{prefix:'merchant_study_',text:
    'Use the declared original Study workspace and inspect its application source and current instance. Source intake retains the original ACS, BLS, HUD or ACS API files and existing SF88/SF100 acquisition. Freeze explicit geography and unit mappings; compare observation periods and source releases separately. Read exact review versions before changing source or property decisions. Use staff-selected purposes, complete comparable cohorts and original source citations. Full native responses are retained with JSON pointers and original file hashes; page them or receive the complete original bytes. An uncertain write is recovered by inspecting this same native workspace and its saved content IDs/review version, never by automatic replay. Close only this alias owned child; a borrowed operator keeps its existing owner. File receiving uses one retained payload with exact offsets and complete SHA256 before original package import.'}]
});
