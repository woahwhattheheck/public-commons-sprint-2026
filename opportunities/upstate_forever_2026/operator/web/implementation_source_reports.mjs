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

export function implementationSelectionSources(selection){
 if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('Choose the complete original report selection.');
 const primary=selection.source_roles?.OBSERVED_CONTEXT;
 const rows=Object.prototype.hasOwnProperty.call(selection,'observed_context_sources')?selection.observed_context_sources:(primary?[primary]:[]);
 if(!Array.isArray(rows)||!rows.length)throw Error('The retained report selection has no observed scientific sources.');
 const sources=implementationReportSources(rows);
 if(sources.length!==rows.length)throw Error('The retained ordered report selection repeats an original source.');
 if(primary&&JSON.stringify(originalSource(primary))!==JSON.stringify(sources[0]))throw Error('The report primary source differs from its first ordered source.');
 return sources;
}
export async function captureImplementationReportSelection(workbench){
 const w=workbench,workspace_key=w.workspace;
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==workspace_key)throw Error('Open the field plan in its original native Workspace.');
 if(typeof w.host.openExtension!=='function')throw Error('Open the current native Report desk to retain its selection.');
 const snapshot=await w.host.openExtension('map-atlas','reportSelection',{workspace_key});
 if(w.gone||w.host.getState?.()?.workspace_key!==workspace_key)return null;
 if(snapshot?.workspace_key!==workspace_key||!snapshot.selection||typeof snapshot.selection!=='object'||Array.isArray(snapshot.selection))throw Error('The Report desk did not return its original selection.');
 return JSON.parse(JSON.stringify(snapshot.selection));
}

export async function openImplementationSourceReport(workbench,values,{title,closeEditor,selection=null}={}){
 const w=workbench;
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open the saved scientific source in its original native workspace.');
 if(typeof w.host.openScientificReport!=='function')throw Error('Install the maintained SourceReports opener in this operator before preparing a standalone scientific report.');
 const sources=selection===null?implementationReportSources(values):implementationSelectionSources(selection),workspace_key=w.workspace;
 w.cache?.();
 if(typeof closeEditor==='function')closeEditor();
 if(w.gone||w.host.getState?.()?.workspace_key!==workspace_key)throw Error('The selected workspace changed before opening the report publisher.');
 const payload={workspace_key,sources};
 if(typeof title==='string'&&title.trim())payload.title=title.trim();
 await w.host.openScientificReport(payload);
}
