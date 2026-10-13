// MIT. Tool listing loads metadata; the existing installed service keeps all native ownership.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {monitoringTools} from './catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'source-monitoring-workspaces',family:'sourceMonitoring',title:'Source Monitoring',
 order:1192,catalogOrder:1192,configKey:'sourceMonitoring',summary:true,dependencies:[],concurrency:'provider',maxRequestBytes:48*1024*1024+65536,
 configuration:{input:'sourceMonitoringConnection',privateExports:true,read:(value,{hostPath})=>import('./merchant.mjs').then(m=>m.readSourceMonitoringConfiguration(hostPath(value)))},
 tools:monitoringTools,
 instructions:[{order:1192,prefix:'merchant_monitoring_',text:'Use the configured physical workspace and exact installed binding. These tools borrow the original Source Monitoring service; they never launch a provider or screening engine. Preserve complete exact authored JSON, original UUIDs and all reviewed cycle/case/review SHA values before dispatch. NATIVE_ERROR is not success: recover the same native request and do not automatically repeat uncertain non-idempotent operations. Caller-authored identity, relevance, portfolio choices and sign-off remain distinct. Original source and licence/provenance stay attached. Read all native pages and every byte of retained responses and downloads; large replies return a complete immutable file selection, never a truncated result. Prefer download followed by retained file_read so a later workspace export cannot replace the selected archive. Reviewer receiving retains unfinished copies, while adoption requires an actual named edition and all explicit choices. Complete native receiving preserves source, original requests, decisions and later history.'}],
 load:()=>import('./merchant.mjs'),create:(module,config)=>new module.MerchantSourceMonitoring(config)
});
