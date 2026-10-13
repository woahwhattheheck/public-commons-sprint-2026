// MIT. Source-selected Tyk workspace merchant provider.
import { defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { tykWorkspaceTools } from '../catalog/tyk-workspace.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'tyk-workspaces',family:'tykWorkspaces',title:'Tyk migration and rollout workspaces',
  order:440,catalogOrder:440,configKey:'tykWorkspaces',summary:true,dependencies:[],
  concurrentTools:['merchant_tyk_cancel_request','merchant_tyk_export_file_release'],shutdown:'provider',maxRequestBytes:128*1024*1024,
  configuration:{input:'tykWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath,base})=>(await import('../tyk-workspace.mjs')).readTykWorkspaceConfiguration(hostPath(value,base))},
  tools:tykWorkspaceTools,
  instructions:[{prefix:'merchant_tyk_',order:180,text:
    'Use the declared original Tyk workspace. Capture its complete native portfolio and save explicit cohorts from that capture. '+
    'For two Gateway targets, create_gateway_commissioning freezes complete source entries and explicit staging/production connections. Prepare each ready step and inspect its original rollout before dispatch. Reload explicitly, capture active sources and record every actual operational check. Native OpenAPI imports require the returned API ID and explicit acceptance of both complete source hashes; never treat an expected ID as native evidence. ' +
    'For a Dashboard cohort, create_commissioning binds the complete saved Classic selection to its operating-plan history. '+
    'Read commissioning progress; prepare only its ready conversion, staging or promotion step, then use the original dispatch tool for that exact rollout. '+
    'Accept native conversion only after reviewing every original and converted definition. Capture current staged definitions, record every API/check result against the returned context SHA, then review and dispatch the original promotion. '+
    'Never mark a missing operational check passed. Refresh the final portfolio and retain the complete commissioning history in the workspace handover. '+
    'Prepare the complete native request, read its exact saved revision and plan SHA, then dispatch that reviewed request with a stable requestId. '+
    'Gateway writes require a separately prepared native reload before activation; Dashboard migration uses its native dryRun, stage, promote or direct operation. '+
    'Read original responses and current native definitions together. Recover an interrupted reply by reading its saved record or replaying the same requestId and input. '+
    'Use adapt_definition to review the exact Classic Gateway/Dashboard envelope for a captured source. '+
    'Use review to page every native field change, then download the complete report and original before/after documents. '+
    'Export the complete workspace, download its original delivery, read every file range through EOF and release the original reader. '+
    'Large action results are retained whole as agent exports. Inspect their manifest and read the original file instead of inferring omitted source. '+
    'Receive a declared complete handover with inspect_delivery and adopt only its exact returned manifest SHA and record revision.'}],
  initialize:options=>(import('../tyk-setup.mjs')).then(module=>module.initializeTykWorkspaceMerchant(options)),
  load:()=>import('../tyk-workspace.mjs'),
  create:(module,config,options)=>new module.MerchantTykWorkspaces(config,options.tyk),
});
