/** Original FIELD12 report sources → the maintained native scientific-report publisher. */
function originalSource(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('The retained scientific report source is unavailable.');
 const source_collection_id=value.source_collection_id,source_id=value.source_id;
 if(typeof source_collection_id!=='string'||!source_collection_id||typeof source_id!=='string'||!source_id)throw Error('The retained report source needs its original collection and source identifiers.');
 return {source_collection_id,source_id};
}
export function implementationReportSources(values){
 if(!Array.isArray(values)||!values.length)throw Error('Choose a registered original report source.');
 const seen=new Set(),sources=[];
 for(const value of values){const source=originalSource(value),key=JSON.stringify([source.source_collection_id,source.source_id]);if(!seen.has(key)){seen.add(key);sources.push(source);}}
 return sources;
}
export async function openImplementationSourceReport(workbench,values,{title,closeEditor}={}){
 const w=workbench;
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open the saved scientific source in its original native workspace.');
 if(typeof w.host.openScientificReport!=='function')throw Error('Install the maintained SourceReports opener in this operator before preparing a standalone scientific report.');
 const sources=implementationReportSources(values),workspace_key=w.workspace;
 w.cache?.();
 if(typeof closeEditor==='function')closeEditor();
 if(w.gone||w.host.getState?.()?.workspace_key!==workspace_key)throw Error('The selected workspace changed before opening the report publisher.');
 const payload={workspace_key,sources};
 if(typeof title==='string'&&title.trim())payload.title=title.trim();
 await w.host.openScientificReport(payload);
}
