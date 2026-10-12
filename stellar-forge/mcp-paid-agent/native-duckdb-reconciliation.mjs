// SPDX-License-Identifier: MIT
// Borrow the existing authenticated request functions; create no listener.
export async function dispatchDuckDBReconciliation({operation,body,get,post,workspaceId}){
 const route='/api/reconciliation',encode=value=>encodeURIComponent(String(value));
 const query=values=>{const entries=Object.entries(values).filter(([,v])=>v!==undefined);return entries.length?'?'+new URLSearchParams(entries.map(([k,v])=>[k,String(v)])):'';};
 const scoped=value=>({...value,workspace_id:workspaceId});
 const pageKind={'reconcile-pairs':'pairs','reconcile-runs':'runs','reconcile-reports':'reports','reconcile-operations':'operations'}[operation];
 if(pageKind)return get(route+'/'+pageKind+query(body));
 if(operation==='reconcile-status')return get(route+'/status');
 if(operation==='reconcile-review')return post(route+'/review',body);
 if(operation==='reconcile-pair')return get(route+'/pairs/'+encode(body.pair_id)+query({revision:body.revision}));
 if(operation==='reconcile-run')return get(route+'/runs/'+encode(body.run_id));
 if(operation==='reconcile-report')return get(route+'/reports/'+encode(body.report_id));
 if(operation==='reconcile-request')return get(route+'/requests/'+encode(body.request_id));
 if(operation==='reconcile-resume')return post(route+'/requests/'+encode(body.request_id)+'/resume',{workspace_id:workspaceId});
 if(operation==='reconcile-changes'){const {report_id,...paging}=body;return get(route+'/reports/'+encode(report_id)+'/changes'+query(paging));}
 const grid={'reconcile-groups':'groups','reconcile-rows':'rows','reconcile-row':'row','reconcile-decisions':'decisions'}[operation];
 if(grid){const {run_id,...parameters}=body;return get(route+'/runs/'+encode(run_id)+'/'+grid+query(parameters));}
 const action={'reconcile-save-pair':'pairs','reconcile-execute':'run','reconcile-decide':'decision','reconcile-save-report':'report'}[operation];
 if(action)return post(route+'/'+action,scoped(body));
 if(operation==='reconcile-export-manifest'){
  const value=await get('/api/exports/'+encode(body.export_id));
  const file=value?.files?.find(item=>item.name==='manifest.json');
  if(value?.schema!=='stellar-forge.duckdb-reconciliation.v1.export'||value.export_id!==body.export_id||
   value.workspace_id!==workspaceId||value.complete!==true||value.state!=='COMPLETE'||!file||
   !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>16*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256??''))
   throw new Error('MCP_DUCKDB_RECONCILIATION_MANIFEST_CHANGED');
  return {schema:value.schema,export_id:value.export_id,workspace_id:value.workspace_id,report_id:value.report_id,
   state:'COMPLETE',manifest_file:{name:'manifest.json',bytes:file.bytes,sha256:file.sha256,mime:'application/json'}};
 }
 if(operation==='reconcile-export')return post(route+'/exports',body);
 throw new Error('MCP_DUCKDB_RECONCILIATION_OPERATION_NOT_FOUND');
}
