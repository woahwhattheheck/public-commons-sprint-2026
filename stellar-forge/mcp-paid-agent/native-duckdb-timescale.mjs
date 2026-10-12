// SPDX-License-Identifier: MIT
// Pure routing over the original native buyer's authenticated service functions.
export async function dispatchDuckDBTimescale({operation,body,get,post,readFile,workspaceId,registeredReports=[]}){
 const base='/api/timescale-intake',encode=value=>encodeURIComponent(String(value));
 const query=values=>{const rows=Object.entries(values).filter(([,v])=>v!==undefined);
  return rows.length?'?'+new URLSearchParams(rows.map(([k,v])=>[k,String(v)])):'';};
 const scoped=value=>({...value,workspace_id:workspaceId});
 if(operation==='timescale-intake-status')return get(base+'/status');
 if(operation==='timescale-intake-registered-reports'){
  const offset=body.offset??0,limit=body.limit??25;
  if(!Number.isSafeInteger(offset)||offset<0||offset>registeredReports.length||
   !Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('MCP_DUCKDB_PAGE_INVALID');
  return {reports:registeredReports.slice(offset,offset+limit).map(({reportPath,...record})=>record),
   offset,limit,total:registeredReports.length,next_offset:offset+limit<registeredReports.length?offset+limit:null};
 }
 const catalog={'timescale-intake-reports':'reports','timescale-intake-reviews':'reviews',
  'timescale-intake-operations':'operations'}[operation];
 if(catalog)return get(base+'/'+catalog+query(body));
 if(operation==='timescale-intake-report')return get(base+'/reports/'+encode(body.report_id));
 if(operation==='timescale-intake-source'){
  const {report_id,source_id,...page}=body;
  return get(base+'/reports/'+encode(report_id)+'/sources/'+encode(source_id)+query(page));
 }
 if(operation==='timescale-intake-request')return get(base+'/requests/'+encode(body.request_id));
 if(operation==='timescale-intake-resume')return post(base+'/requests/'+encode(body.request_id)+'/resume',{workspace_id:workspaceId});
 if(operation==='timescale-intake-retain'){
  const selected=registeredReports.find(value=>value.name===body.source);
  if(!selected||selected.sha256!==body.sha256)throw new Error('MCP_DUCKDB_REGISTERED_TIMESCALE_REPORT_REQUIRED');
  return post(base+'/retain',{request_id:body.request_id,workspace_id:workspaceId,
   report_path:selected.reportPath,sha256:selected.sha256,filename:selected.filename});
 }
 if(operation==='timescale-intake-review')return post(base+'/reviews',scoped(body));
 if(operation==='timescale-intake-import')return post(base+'/imports',scoped(body));
 if(operation==='timescale-intake-pair-review')return post(base+'/pair-review',body);
 if(operation==='timescale-intake-save-pair')return post(base+'/pairs',scoped(body));
 if(operation==='timescale-intake-file')return readFile(body);
 if(operation==='timescale-intake-manifest'){
  const report=await get(base+'/reports/'+encode(body.report_id)),file=report?.receiving_manifest;
  if(report.report_id!==body.report_id||report.sha256!==body.report_id||
   file?.name!=='intake-receiving.json'||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2097152||
   !/^[a-f0-9]{64}$/.test(file.sha256??''))throw new Error('MCP_DUCKDB_TIMESCALE_MANIFEST_CHANGED');
  return {schema:'stellar-forge.duckdb-timescale-intake.v1',report_id:body.report_id,
   workspace_id:workspaceId,manifest_file:file};
 }
 throw new Error('MCP_DUCKDB_TIMESCALE_OPERATION_NOT_FOUND');
}
