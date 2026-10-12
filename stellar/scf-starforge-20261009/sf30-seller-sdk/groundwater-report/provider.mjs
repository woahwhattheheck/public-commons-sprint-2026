// SPDX-License-Identifier: MIT
// Source-owned metadata; native desk modules stay behind the maintained lazy provider hook.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
export const REPORT_ACTIONS=Object.freeze(['publish','buyer.prepare','buyer.prepare-catalog','buyer.capture','receiving.preview','receiving.commit','continue','desk.export','desk.restore']);
export function reportTools(tool){
  const selected={desk:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'}},id={type:'string',maxLength:120};
  return [
    tool('merchant_groundwater_report_desks','List configured original Groundwater report desks and exact identity bindings.',{},[],{readOnly:true,idempotent:true}),
    tool('merchant_groundwater_report_read','Read source reports, original publication or receiving, buyer/Operations choices, or the same saved operation before continuing.',
      {...selected,kind:{type:'string',enum:['state','reports','report','publication','receiving','operation','cases','case']},id},['desk','kind'],{readOnly:true,idempotent:true}),
    tool('merchant_groundwater_report_action','Perform one explicit original report publication, buyer preparation/capture, report receiving, same-operation continuation or full desk export/restore. Retain the same operationId and complete input after an uncertain result. This tool dispatches no solver or buyer payment.',
      {...selected,action:{type:'string',enum:[...REPORT_ACTIONS]},input:{type:'object'}},['desk','action','input'],{}),
    tool('merchant_groundwater_report_file','Read a bounded original file range through the maintained immutable-file reader. Read the returned complete SHA-256, preserve readId for subsequent ranges, and release it when finished.',
      {...selected,operationId:id,kind:{type:'string',enum:['catalog','report','buyer-config','handoff','review','received-html','complete-export']},
        format:{type:'string',enum:['zip','json','html','csv']},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:262144},readId:{type:'string'}},
      ['desk','operationId','kind','expectedSha256'],{readOnly:true,idempotent:true}),
    tool('merchant_groundwater_report_file_release','Release this exact retained original file read.',
      {...selected,readId:{type:'string'}},['desk','readId'],{readOnly:true,idempotent:true}),
  ];
}
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'groundwater-reports',family:'groundwaterReports',title:'Groundwater report distribution and receiving',
  order:1160,catalogOrder:1160,configKey:'groundwaterReports',summary:true,dependencies:[],concurrency:'provider',
  maxRequestBytes:36*1024*1024,
  configuration:{input:'groundwaterReportConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./provider-runtime.mjs')).readConfiguration(hostPath(value))},
  tools:reportTools,
  instructions:[{order:1160,prefix:'merchant_groundwater_report_',text:'Select a configured original report desk. Inspect the frozen report and its source/unit findings before publication. Use the original responseAsset catalog and SF88 configuration; buyer signing and payment remain with the original authorized buyer. Reopen the actual saved SF88 handoff and exact report response before receiving or linking a selected Operations case. Keep original operation IDs, explicit case/deployment/purchase selections and complete archive hashes. Read historical results and original files after an uncertain response; do not substitute a new model, report, purchase or source capture.'}],
  load:()=>import('./provider-runtime.mjs'),create:(module,config,options)=>new module.MerchantGroundwaterReports(config,options),
});
