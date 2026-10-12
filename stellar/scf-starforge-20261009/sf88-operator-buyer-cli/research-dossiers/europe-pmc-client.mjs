// MIT. Europe PMC operations on an existing identity-checked Research attachment.
import {resolve} from 'node:path';
import {need,object} from '../node/store.mjs';
import {readResearchHostFile,openResearchSource} from './workspace-files.mjs';
const endpoint='/api/europe-pmc';
const pathId=value=>{need(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),'EUROPE_PMC_ID_INVALID');return encodeURIComponent(value);};
const parameters=value=>{const query=new URLSearchParams();for(const[key,item]of Object.entries(value??{}))if(item!==undefined&&item!==null)query.set(key,String(item));return query.size?'?'+query.toString():'';};
export function createEuropePmcClient({request,download,upload}={}) {
  need(typeof request==='function'&&typeof download==='function'&&typeof upload==='function','EUROPE_PMC_RESEARCH_CLIENT_REQUIRED');
  let selection=null;
  const options=value=>({...value,headers:{...(value?.headers??{}),...(selection?{'X-Europe-Pmc-Selection':selection}:{})}});
  const read=(path,input,selected)=>request(endpoint+path,input,options(selected));
  const operation=id=>'/operations/'+pathId(id);
  return {
    async list(input={}){const value=await read(parameters(input));selection=value.selection.library;return value;},
    status:()=>read('/status'),
    history:()=>read('/history'),
    query:id=>read('/queries/'+pathId(id)),
    saveQuery:input=>read('/queries',input),
    prepare:input=>read('/operations',input),
    inspect:id=>read(operation(id)),
    start:(id,input)=>read(operation(id)+'/start',input),
    stop:id=>read(operation(id)+'/stop',{}),
    seal:(id,input)=>read(operation(id)+'/seal',input),
    continueSearch:(id,input)=>read(operation(id)+'/continue',input),
    chain:id=>read(operation(id)+'/chain'),
    records:(id,input={})=>read(operation(id)+'/records'+parameters(input)),
    source:(id,index,{boundary=false}={})=>read(operation(id)+'/source'+parameters({index,descriptor:true,boundary})),
    importDocuments:(id,input)=>read(operation(id)+'/import',input),
    async importFile(id,{file,sha256,expectedPlanSha256,stopReason=null}={}) {
      const bytes=await readResearchHostFile(resolve(file),48*1024*1024,{sha256});
      const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      need(object(packet)&&packet.schema==='stellar-forge.europe-pmc-import.v1','EUROPE_PMC_IMPORT_PACKET_INVALID');
      need((packet.documents===undefined)!==(packet.pages===undefined),'EUROPE_PMC_ORIGINAL_IMPORT_REQUIRED');
      return read(operation(id)+'/import',{expectedPlanSha256,stopReason:packet.stopReason??stopReason,
        ...(packet.documents?{documents:packet.documents}:{pages:packet.pages})});
    },
    review:input=>read('/reviews',input),
    receive:(id,input)=>read(operation(id)+'/receive',input),
    comparison:input=>read('/comparison'+parameters(input)),
    exportEdition:(id,{file,format='edition',...selected}={})=>{
      need(['edition','ris','csv','review'].includes(format),'EUROPE_PMC_EXPORT_FORMAT_INVALID');
      return download(endpoint+operation(id)+'/files/'+format,file,options(selected));
    },
    exportSource:(id,{file,index,boundary=false,...selected}={})=>download(endpoint+operation(id)+'/source'+parameters({index,boundary}),file,options(selected)),
    exportWorkspace:input=>read('/exports',input),
    downloadWorkspace:({requestId,file,...selected})=>download(endpoint+'/exports/'+pathId(requestId),file,options(selected)),
    async restoreFile({requestId,actor,file,expectedSha256,...selected}={}) {
      const source=await openResearchSource(resolve(file),128*1024*1024,{sha256:expectedSha256});
      try{const value=await upload(endpoint+'/restore'+parameters({requestId,actor,sha256:source.sha256}),source,options(selected));
        selection=value.selected.library;return value;}
      finally{await source.close();}
    },
  };
}
