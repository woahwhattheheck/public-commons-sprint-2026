// MIT. Original Analysis report editorial workflow and complete recipient handovers.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {reportEditorialTools,HTTP_BYTES} from '../catalog/report-editorial.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'report-editorial',family:'reportEditorial',title:'Report editorial returns',
 order:725,catalogOrder:725,configKey:'reportEditorial',summary:true,dependencies:[],
 concurrency:'provider',shutdown:'provider',maxRequestBytes:HTTP_BYTES,
 configuration:{input:'reportEditorialConnection',privateExports:true,
  read:async(value,{hostPath,base})=>(await import('../report-editorial-connection.mjs')).readReportEditorialConfiguration(hostPath(value,base))},
 tools:reportEditorialTools,load:()=>import('../report-editorial-agent.mjs'),
 create:(module,config)=>new module.MerchantReportEditorialAgent(config),
 requestClose:provider=>provider.requestClose(),
 instructions:[{prefix:'merchant_report_editorial_',order:725,text:
  'Use the host-declared original Analysis workspace and actual COMPLETE report job/result SHA. '+
  'Issue full typed report sources to the named reviewer, then receive every recipient file. External sending remains separately authorized. '+
  'Keep all history pages and complete attributed returns; upload the actual full JSON in retained fragments with its original hash and return ID. '+
  'Read the full comparison.json before explicitly choosing each field and section mapping. Apply only the exact reviewed preview hash and original request ID. '+
  'After an unknown reply read original status, retain the same complete intent, and replay that request; never replace its ID to hide uncertainty. '+
  'NEEDS_REVIEW is a recorded rejection requiring a fresh comparison and new explicitly reviewed request. It is not a saved report. '+
  'Receive manifest and all original files through EOF with expected SHA256 and exact byte counts. Files remain readable after Analysis closes. '+
  'The report-editorial-agent CLI preserves complete requests and independently receives the full source package. '+
  'This provider uses the existing Analysis owner; it creates no dataset, source import, report run, publication, schedule or payment.'}]
});
