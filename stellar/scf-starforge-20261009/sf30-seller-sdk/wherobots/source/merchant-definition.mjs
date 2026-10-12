// MIT. Source-owned metadata for the original Wherobots workspace.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from "../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs";
import {wherobotsMerchantTools} from "./merchant-tools.mjs";

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:"wherobots-workspaces",family:"wherobotsWorkspaces",
  title:"Wherobots spatial workflows and complete source receiving",order:600,catalogOrder:600,
  configKey:"wherobotsWorkspaces",summary:true,dependencies:[],maxRequestBytes:2*1024*1024,
  concurrency:"provider",shutdown:"provider",
  configuration:{input:"wherobotsWorkspaceConnection",privateExports:true,
    read:async(value,{hostPath})=>(await import("./merchant-provider.mjs")).readWherobotsWorkspaceConfiguration(hostPath(value))},
  tools:wherobotsMerchantTools,
  instructions:[{prefix:"merchant_wherobots_",text:
    "Operate the original host-declared Wherobots workspace and its selected Python/SDK runtime. Use status/open to select its pinned workspace identity. Retain original source files through named inputs; review the saved native workflow revision before submit or attach. Reuse the same operation_id for recovery and receive every output part through capture. Source-interoperability collections retain their original source account and run fields. Page rows, log captures, record collections and events to completion. Export requires a stable export_id and the saved workflow/edition revision; use export_status and file to receive every unchanged original file. Reopening the same export_id returns its completed edition after later source changes. Import accepts a named complete original or corrected handover. Close drains this attachment and keeps the saved workspace available."}],
  load:()=>import("./merchant-provider.mjs"),
  create:(module,config,options)=>new module.MerchantWherobotsWorkspaces(config,{
    ...(options.environment===undefined?{}:{environment:options.environment}),...options.wherobots}),
  initialize:async(options)=>(await import("./merchant-setup.mjs")).initializeWherobotsMerchant(options)
});
