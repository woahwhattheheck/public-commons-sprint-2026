// MIT. Borrow the original managed Highway service; native ownership remains there.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {highwayFieldTools} from './catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'highway-field-workspaces',family:'highwayField',title:'Highway field operations',
 order:1185,catalogOrder:1185,configKey:'highwayField',summary:true,dependencies:[],concurrency:'provider',maxRequestBytes:8*1024*1024,
 configuration:{input:'highwayFieldConnection',privateExports:true,read:(value,{hostPath})=>import('./merchant.mjs').then(m=>m.readHighwayFieldConfiguration(hostPath(value)))},
 tools:highwayFieldTools,
 instructions:[{order:1185,prefix:'merchant_highway_',text:'Use the exact configured original or received physical directory and its portable UUID. These tools borrow the existing managed staff service. Captures are original read-only ArcGIS observations; proposals and inspection approvals are local work, not external GIS edits. Retain full staff/native operation UUIDs and inputs before effects, inspect original request outcomes after uncertain returns, and associate native recordBody using reconciliation.record at the reviewed staff revision. Original SF30/SF100 and paired DuckDB engines own dataset production and comparison. Follow every nextOffset or original next_offset and every complete file chunk. Export one frozen revision; receiving preserves original history and later receiver edits. Open the received directory through its own Applications entry, selecting its independently restored native warehouse when needed.'}],
 load:()=>import('./merchant.mjs'),create:(module,config)=>new module.MerchantHighwayField(config)
});
